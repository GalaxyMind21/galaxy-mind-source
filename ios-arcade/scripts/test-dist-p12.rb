#!/usr/bin/env ruby
# Round-trip a throwaway PKCS#12 and the encrypted artifact.
# Prints no key, no password, and no passphrase.
require "base64"
require "digest"
require "json"
require "open3"
require "tmpdir"
require_relative "../fastlane/dist_p12"

CANARY = "CANARY-P12-PASSWORD".freeze
P8 = "CANARY-P8-DO-NOT-LEAK\n".freeze

def die(msg)
  warn("dist p12 test: #{msg}")
  exit 1
end

def assert_format(secret, prefix)
  DistP12.decode(secret)
  die("expected failure")
rescue DistP12::FormatError => e
  die("wrong failure") unless e.message.start_with?(prefix)
  die("leaked input") if !secret.empty? && secret.length > 8 && e.message.include?(secret)
  die("missing lengths") unless e.message.include?("len=") && e.message.include?("body_len=")
end

def assert_clean(text, label)
  die("#{label} leaked the password") if text.to_s.include?(CANARY)
  die("#{label} leaked the p8") if text.to_s.include?("CANARY-P8")
end

Dir.mktmpdir("dist-p12") do |dir|
  key = File.join(dir, "key.pem")
  cert = File.join(dir, "cert.pem")
  p12 = File.join(dir, "out.p12")
  ENV["TEST_P12_PASSWORD"] = CANARY
  gen = Open3.capture3("openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", key)
  die("genpkey") unless gen[2].success?
  req = Open3.capture3("openssl", "req", "-x509", "-new", "-key", key, "-out", cert, "-subj", "/CN=DistP12Test", "-days", "1")
  die("req") unless req[2].success?
  exported = Open3.capture3(
    "openssl", "pkcs12", "-export",
    "-inkey", key, "-in", cert, "-out", p12,
    "-passout", "env:TEST_P12_PASSWORD"
  )
  assert_clean(exported[0], "export stdout")
  assert_clean(exported[1], "export stderr")
  die("export") unless exported[2].success? && File.size?(p12)
  raw = File.binread(p12)
  die("short p12") if raw.bytesize < 64 || raw.getbyte(0) != 0x30
  b64 = Base64.strict_encode64(raw)
  messy = " \n#{b64.scan(/.{1,16}/).join(" ")}\r\n%"
  decoded = DistP12.decode(messy)
  die("roundtrip") unless decoded == raw

  ENV["DIST_CERT_P12_PASSWORD"] = "#{CANARY}\n"
  restored = File.join(dir, "restored.pem")
  File.binwrite(File.join(dir, "restored.p12"), decoded)
  readback = Open3.capture3(
    { "DIST_CERT_P12_PASSWORD" => DistP12.password },
    "openssl", "pkcs12", "-in", File.join(dir, "restored.p12"),
    "-passin", "env:DIST_CERT_P12_PASSWORD",
    "-nodes", "-out", restored
  )
  assert_clean(readback[0], "openssl stdout")
  assert_clean(readback[1], "openssl stderr")
  die("openssl read") unless readback[2].success?
  die("password not stripped") unless DistP12.password == CANARY

  assert_format("A", "DIST_CERT_P12_BASE64 is not valid base64 ")
  assert_format("%", "DIST_CERT_P12_BASE64 is not valid base64 ")
  assert_format(Base64.strict_encode64("hello"), "DIST_CERT_P12_BASE64 is not a PKCS#12 file ")
  hello_err = nil
  begin
    DistP12.decode(Base64.strict_encode64("hello"))
  rescue DistP12::FormatError => e
    hello_err = e.message
  end
  die("der flag") unless hello_err.include?("der=false")
  die("leaked hello") if hello_err.include?("hello") || hello_err.include?("aGVsbG8")

  saved = {}
  %w[DIST_CERT_P12_PASSWORD DIST_CERT_P12_BASE64].each do |name|
    saved[name] = ENV[name]
    ENV.delete(name)
  end
  die("empty configured") if DistP12.configured? || DistP12.password_present? || DistP12.base64_present? || DistP12.half_configured?
  ENV["DIST_CERT_P12_PASSWORD"] = CANARY
  die("password only") if DistP12.configured? || !DistP12.half_configured? || !DistP12.password_present?
  ENV["DIST_CERT_P12_BASE64"] = messy
  die("both") unless DistP12.configured?
  die("half when both") if DistP12.half_configured?
  ENV["DIST_CERT_P12_PASSWORD"] = "   "
  die("blank password") if DistP12.password_present? || DistP12.configured?
  saved.each do |name, value|
    if value.nil?
      ENV.delete(name)
    else
      ENV[name] = value
    end
  end

  phrase = DistP12.artifact_passphrase(" KEYID ", P8)
  same = DistP12.artifact_passphrase("KEYID", P8)
  shifted = DistP12.artifact_passphrase("KEYID", P8.chomp)
  expected = Digest::SHA256.hexdigest("KEYID\n#{P8}")
  die("passphrase mismatch") unless phrase == same && phrase == expected
  die("passphrase ignored a trailing newline") if shifted == phrase
  die("passphrase shape") unless phrase.match?(/\A[0-9a-f]{64}\z/)
  assert_clean(phrase, "passphrase")

  File.binwrite(File.join(dir, "distribution.p12"), raw)
  File.binwrite(File.join(dir, "password.txt"), CANARY)
  tar = File.join(dir, "dist-cert.tar")
  packed = Open3.capture3("tar", "-cf", tar, "-C", dir, "distribution.p12", "password.txt")
  die("tar") unless packed[2].success?
  gpg = File.join(dir, "dist-cert.p12.gpg")
  home = File.join(dir, "gnupg")
  Dir.mkdir(home)
  File.chmod(0o700, home)
  DistP12.encrypt_symmetric(tar, gpg, phrase, gnupghome: home)
  die("gpg missing") unless File.size?(gpg)
  plain = File.binread(gpg)
  assert_clean(plain, "ciphertext")
  out_tar = File.join(dir, "back.tar")
  home2 = File.join(dir, "gnupg2")
  Dir.mkdir(home2)
  File.chmod(0o700, home2)
  DistP12.decrypt_symmetric(gpg, out_tar, phrase, gnupghome: home2)
  unpack = File.join(dir, "unpack")
  Dir.mkdir(unpack)
  extracted = Open3.capture3("tar", "-xf", out_tar, "-C", unpack)
  die("untar") unless extracted[2].success?
  die("password file") unless File.binread(File.join(unpack, "password.txt")) == CANARY
  die("p12 file") unless File.binread(File.join(unpack, "distribution.p12")) == raw
  begin
    DistP12.decrypt_symmetric(gpg, File.join(dir, "nope.tar"), "0" * 64, gnupghome: home2)
    die("wrong passphrase decrypted")
  rescue DistP12::FormatError => e
    assert_clean(e.message, "gpg error")
    die("gpg status") unless e.message.include?("status=")
  end

  root = File.expand_path("..", __dir__)
  sources = [
    File.read(File.join(root, "fastlane/Fastfile")),
    File.read(File.join(root, "fastlane/dist_p12.rb")),
    (File.exist?(File.join(root, "../.github/workflows/ios-testflight.yml")) ? File.read(File.join(root, "../.github/workflows/ios-testflight.yml")) : ""), # export copy: the workflow may be absent
    File.read(File.join(root, "README.md"))
  ].join("\n")
  assert_clean(sources, "sources")
  die("old secret name") if sources.include?("APPLE_DIST_P12")
  # The lane never writes repository secrets (security audit 2026-10-18, H4).
  die("secrets token path") if %w[Fastfile dist_p12.rb].any? { |f| File.read(File.join(root, "fastlane", f)).match?(/GH_SECRETS_PAT|actions\/secrets|seal_secret/) }
  helper = File.read(File.join(root, "fastlane/dist_p12.rb"))
  fastfile = File.read(File.join(root, "fastlane/Fastfile"))
  workflow = File.exist?(File.join(root, "../.github/workflows/ios-testflight.yml")) ? File.read(File.join(root, "../.github/workflows/ios-testflight.yml")) : ""
  readme = File.read(File.join(root, "README.md"))
  [fastfile, workflow, readme].each do |text|
    die("password flag") if text.include?('"-P"')
  end
  die("pkcs12 import missing") unless helper.include?('"-P", password')
  die("password flag") unless helper.scan('"-P"').length == 1
  scrubbed = DistP12.scrub_security("MAC failed #{CANARY}\nsafe line\n", CANARY)
  die("scrub leaked") if scrubbed.include?(CANARY)
  die("scrub dropped the safe line") unless scrubbed == "safe line"
end

puts "dist p12 ok"
