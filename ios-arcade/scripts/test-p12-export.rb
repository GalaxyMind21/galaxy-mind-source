#!/usr/bin/env ruby
# Package a throwaway identity the way the create step writes it:
# PEM private key in {id}.p12, DER certificate in {id}.cer.
# Prints no key and no password.
require "open3"
require "securerandom"
require "tmpdir"
require_relative "../fastlane/dist_p12"

def die(msg)
  warn("p12 export test: #{msg}")
  exit 1
end

def run(bin, *args, env: nil)
  cmd = env ? [env, bin, *args] : [bin, *args]
  Open3.capture3(*cmd)
end

bin = DistP12.openssl_bin
password = SecureRandom.hex(24)
id = "TESTCERT01"

Dir.mktmpdir("p12-export") do |dir|
  key_pem = File.join(dir, "key.pem")
  cert_pem = File.join(dir, "cert.pem")
  key_file = File.join(dir, "#{id}.p12")
  cer_file = File.join(dir, "#{id}.cer")
  out_file = File.join(dir, "distribution.p12")
  cfg = File.join(dir, "cert.cnf")
  File.write(cfg, <<~CNF)
    [req]
    distinguished_name = req_dn
    x509_extensions = req_ext
    prompt = no
    [req_dn]
    CN = GalaxyMindP12Test
    [req_ext]
    keyUsage = digitalSignature
    extendedKeyUsage = codeSigning
    basicConstraints = CA:FALSE
  CNF

  gen = run(bin, "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", key_pem)
  die("genpkey status=#{gen[2].exitstatus}") unless gen[2].success?
  req = run(bin, "req", "-x509", "-new", "-key", key_pem, "-out", cert_pem, "-days", "1", "-config", cfg)
  die("req status=#{req[2].exitstatus}") unless req[2].success?
  der = run(bin, "x509", "-in", cert_pem, "-outform", "DER", "-out", cer_file)
  die("der status=#{der[2].exitstatus}") unless der[2].success?

  traditional = File.join(dir, "traditional.pem")
  rsa = run(bin, "pkey", "-in", key_pem, "-traditional", "-out", traditional)
  rsa = run(bin, "rsa", "-in", key_pem, "-out", traditional) unless rsa[2].success?
  die("traditional key status=#{rsa[2].exitstatus}") unless rsa[2].success?
  preamble = "created by the certificate step\n#{File.read(traditional)}"
  File.binwrite(key_file, preamble)
  File.chmod(0o600, key_file)

  rejected = run(
    bin, "pkcs12", "-export",
    "-inkey", key_pem,
    "-in", cert_pem,
    "-inform", "PEM",
    "-out", File.join(dir, "rejected.p12"),
    "-passout", "pass:unused"
  )
  die("pkcs12 accepted an input format flag") if rejected[2].success?

  DistP12.export_identity(key_file, cer_file, out_file, password)
  raw = File.binread(out_file)
  die("short p12") if raw.bytesize < 64 || raw.getbyte(0) != 0x30
  die("export env leaked") unless ENV[DistP12::EXPORT_ENV].nil?
  die("unwrap env leaked") unless ENV[DistP12::UNWRAP_ENV].nil?
  die("password leaked into the file name") if out_file.include?(password)

  if RUBY_PLATFORM.include?("darwin") && !File.executable?("/usr/bin/security")
    die("security missing on macOS")
  end
  DistP12.verify_reusable!(out_file, password)

  unwrapped = File.join(dir, "unwrapped.pem")
  DistP12.unwrap_pkcs12(out_file, password, unwrapped)
  die("identity parts #{DistP12.identity_part_counts(unwrapped).inspect}") unless DistP12.identity_part_counts(unwrapped) == [1, 1]
  original_pub, _err, original_status = run(bin, "pkey", "-in", key_pem, "-pubout")
  packed_pub, _err2, packed_status = run(bin, "pkey", "-in", unwrapped, "-pubout")
  die("pubout status=#{original_status.exitstatus}/#{packed_status.exitstatus}") unless original_status.success? && packed_status.success?
  die("public key mismatch") unless original_pub == packed_pub

  flags = DistP12.pkcs12_flags
  die("flags") unless flags.is_a?(Array)
  if flags.include?("-legacy")
    bare = run(
      bin, "pkcs12", "-in", out_file, "-nodes", "-passin", "env:P12_EXPORT_TEST_PASSWORD", "-out", File.join(dir, "bare.pem"),
      env: { "P12_EXPORT_TEST_PASSWORD" => password }
    )
    die("legacy p12 unwrapped without the legacy flag") if bare[2].success?
    die("legacy unwrap leaked") if bare[0].to_s.include?(password) || bare[1].to_s.include?(password)
  end

  pem_cer = File.join(dir, "pem.cer")
  File.binwrite(pem_cer, File.binread(cert_pem))
  pem_out = File.join(dir, "from-pem.p12")
  DistP12.export_identity(key_pem, pem_cer, pem_out, password)
  die("pem cert export") unless File.binread(pem_out).getbyte(0) == 0x30

  begin
    DistP12.export_identity(key_file, cer_file, File.join(dir, "empty.p12"), "")
    die("empty password exported")
  rescue DistP12::FormatError => e
    die("empty password message=#{e.message}") unless e.message == "pkcs12 password is empty"
    die("empty password leaked") if e.message.include?(password)
  end

  begin
    DistP12.export_identity(File.join(dir, "missing.key"), cer_file, File.join(dir, "nope.p12"), password)
    die("missing key exported")
  rescue DistP12::FormatError => e
    die("missing key message") unless e.message == "private key file missing"
    die("missing key leaked") if e.message.include?(password)
  end
end

root = File.expand_path("..", __dir__)
fastfile = File.read(File.join(root, "fastlane/Fastfile"))
helper = File.read(File.join(root, "fastlane/dist_p12.rb"))
die("input format flag is back on the pkcs12 export") if fastfile.include?('"-inform"')
die("revoke call missing") unless fastfile.include?("revoke_distribution_certificate!")
die("export helper missing") unless helper.include?("def export_identity")
die("pkcs12 import missing") unless helper.include?("def import_pkcs12") && fastfile.include?("import_pkcs12(")
die("pem keychain import is back") if helper.include?("def import_pem_identity") || fastfile.include?("import_pem_identity")

mode = File.executable?("/usr/bin/security") ? "checked" : "skipped"
puts "p12 export ok keychain=#{mode}"
