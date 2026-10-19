# Saved Apple Distribution PKCS#12.
# Failure text is lengths, statuses, and booleans. Never the file,
# the password, the passphrase, or the API token.
require "base64"
require "json"
require "open3"
require "openssl"
require "securerandom"
require "tmpdir"

module DistP12
  class FormatError < StandardError
  end

  BASE64_ENV = "DIST_CERT_P12_BASE64".freeze
  PASSWORD_ENV = "DIST_CERT_P12_PASSWORD".freeze
  EXPORT_ENV = "DIST_CERT_EXPORT_PASSWORD".freeze
  UNWRAP_ENV = "DIST_CERT_UNWRAP_PASSWORD".freeze

  module_function

  def password
    ENV[PASSWORD_ENV].to_s.sub(/\r?\n\z/, "")
  end

  def password_present?
    !password.strip.empty?
  end

  def base64_present?
    !alphabet(ENV[BASE64_ENV]).empty?
  end

  def configured?
    password_present? && base64_present?
  end

  def half_configured?
    password_present? != base64_present?
  end

  def alphabet(secret)
    secret.to_s.gsub(%r{[^A-Za-z0-9+/=]}, "").delete("=")
  end

  def decode64(padded)
    Base64.strict_decode64(padded)
  rescue ArgumentError
    begin
      padded.unpack1("m")
    rescue ArgumentError
      nil
    end
  end

  # Returns the raw PKCS#12 bytes. Raises FormatError with lengths only.
  def decode(secret)
    raw_len = secret.to_s.bytesize
    body = alphabet(secret)
    mod4 = body.length % 4
    if body.empty? || mod4 == 1
      raise FormatError, "DIST_CERT_P12_BASE64 is not valid base64 len=#{raw_len} body_len=#{body.length} mod4=#{mod4}"
    end
    padded = body + ("=" * ((4 - mod4) % 4))
    bytes = decode64(padded)
    if bytes.nil? || bytes.empty?
      raise FormatError, "DIST_CERT_P12_BASE64 is not valid base64 len=#{raw_len} body_len=#{body.length} mod4=#{mod4}"
    end
    bytes = bytes.b
    der = bytes.getbyte(0) == 0x30
    unless der && bytes.bytesize >= 64
      raise FormatError, "DIST_CERT_P12_BASE64 is not a PKCS#12 file len=#{raw_len} body_len=#{body.length} der=#{der}"
    end
    bytes
  end

  def write_file(secret, path)
    bytes = decode(secret)
    File.binwrite(path, bytes)
    File.chmod(0o600, path)
    bytes
  end

  # Hex SHA-256 of the trimmed key id, a newline, and the .p8 secret
  # exactly as stored. The same string decrypts the workflow artifact.
  def artifact_passphrase(key_id, p8)
    id = key_id.to_s.strip
    raise FormatError, "ASC_KEY_ID is empty" if id.empty?
    raw = p8.nil? ? "" : p8.to_s
    raise FormatError, "ASC_KEY_P8 is empty" if raw.empty?
    OpenSSL::Digest::SHA256.hexdigest("#{id}\n#{raw}")
  end

  def openssl_bin
    return "/usr/bin/openssl" if File.executable?("/usr/bin/openssl")
    "openssl"
  end

  def require_tool!(name)
    found = ENV["PATH"].to_s.split(File::PATH_SEPARATOR).any? do |dir|
      File.executable?(File.join(dir, name))
    end
    return if found
    raise FormatError, "#{name} is not installed"
  end

  def encrypt_symmetric(input_path, output_path, passphrase, gnupghome: nil)
    raise FormatError, "passphrase is empty" if passphrase.to_s.empty?
    run_gpg(input_path, output_path, passphrase, gnupghome, decrypt: false)
  end

  def decrypt_symmetric(input_path, output_path, passphrase, gnupghome: nil)
    raise FormatError, "passphrase is empty" if passphrase.to_s.empty?
    run_gpg(input_path, output_path, passphrase, gnupghome, decrypt: true)
  end

  def run_gpg(input_path, output_path, passphrase, gnupghome, decrypt:)
    env = {}
    env["GNUPGHOME"] = gnupghome unless gnupghome.to_s.empty?
    cmd = [
      "gpg", "--batch", "--yes", "--pinentry-mode", "loopback",
      "--passphrase-fd", "3"
    ]
    if decrypt
      cmd += ["--decrypt", "--output", output_path, input_path]
    else
      cmd += ["--symmetric", "--cipher-algo", "AES256", "--output", output_path, input_path]
    end
    status = nil
    IO.pipe do |reader, writer|
      writer.write(passphrase)
      writer.write("\n")
      writer.close
      _out, _err, status = Open3.capture3(env, *cmd, 3 => reader)
    end
    return if status.success? && File.file?(output_path) && !File.empty?(output_path)
    File.delete(output_path) if File.exist?(output_path)
    verb = decrypt ? "decrypt" : "encrypt"
    raise FormatError, "gpg symmetric #{verb} failed status=#{status.exitstatus}"
  end

  # OpenSSL 3 defaults to PBES2, which macOS security import rejects.
  # -legacy is the PBE that import accepts. LibreSSL has no -legacy flag
  # and its default export is already that older PBE. The same flags have
  # to be used on the way back out, or the read fails closed.
  def pkcs12_flags
    return @pkcs12_flags if instance_variable_defined?(:@pkcs12_flags)
    out, err, status = Open3.capture3(openssl_bin, "pkcs12", "-help")
    text = "#{out}#{err}"
    unless status.success? || text.include?("pkcs12")
      raise FormatError, "openssl pkcs12 help failed status=#{status.exitstatus}"
    end
    @pkcs12_flags = text.include?("-legacy") ? ["-legacy"].freeze : [].freeze
  end

  # cert writes {id}.cer as DER (or PEM). pkcs12 itself has no -inform
  # flag on OpenSSL 3 or LibreSSL, so the certificate is PEM before export.
  def prepare_cert(src, dest)
    body = File.binread(src)
    if body.lstrip.start_with?("-----BEGIN")
      File.binwrite(dest, body)
      File.chmod(0o600, dest)
      return
    end
    _out, _err, status = Open3.capture3(
      openssl_bin, "x509",
      "-inform", "DER",
      "-in", src,
      "-outform", "PEM",
      "-out", dest
    )
    unless status.success? && File.file?(dest) && !File.empty?(dest)
      File.delete(dest) if File.exist?(dest)
      raise FormatError, "x509 pem conversion failed status=#{status.exitstatus}"
    end
    File.chmod(0o600, dest)
  end

  # cert writes the new private key as PEM into a file named {id}.p12.
  # That file is not a PKCS#12. A DER key is converted the same way.
  def prepare_key(src, dest)
    body = File.binread(src)
    text = body.dup.force_encoding(Encoding::ASCII_8BIT)
    begin_at = text.index("-----BEGIN")
    end_at = begin_at && text.index("-----END", begin_at)
    if begin_at && end_at
      line_end = text.index("\n", end_at)
      pem = line_end ? text[begin_at..line_end] : text[begin_at..]
      pem = pem.b + "\n" unless pem.end_with?("\n")
      File.binwrite(dest, pem)
      File.chmod(0o600, dest)
      return
    end
    _out, _err, status = Open3.capture3(
      openssl_bin, "pkey",
      "-inform", "DER",
      "-in", src,
      "-out", dest
    )
    unless status.success? && File.file?(dest) && !File.empty?(dest)
      File.delete(dest) if File.exist?(dest)
      raise FormatError, "pkey pem conversion failed status=#{status.exitstatus}"
    end
    File.chmod(0o600, dest)
  end

  # Build a real PKCS#12 from the private-key file and the .cer file.
  # The password stays in the child environment. Failure text is a status.
  def export_identity(key_path, cert_path, out_path, password)
    raise FormatError, "pkcs12 password is empty" if password.to_s.empty?
    raise FormatError, "private key file missing" unless File.file?(key_path) && !File.empty?(key_path)
    raise FormatError, "certificate file missing" unless File.file?(cert_path) && !File.empty?(cert_path)
    Dir.mktmpdir("dist-p12-export") do |dir|
      key_pem = File.join(dir, "key.pem")
      cert_pem = File.join(dir, "cert.pem")
      prepare_key(key_path, key_pem)
      prepare_cert(cert_path, cert_pem)
      _out, _err, status = Open3.capture3(
        { EXPORT_ENV => password },
        openssl_bin, "pkcs12", "-export",
        *pkcs12_flags,
        "-inkey", key_pem,
        "-in", cert_pem,
        "-out", out_path,
        "-passout", "env:#{EXPORT_ENV}"
      )
      ok = status.success? && File.file?(out_path) && !File.empty?(out_path)
      ok &&= File.binread(out_path).getbyte(0) == 0x30
      unless ok
        File.delete(out_path) if File.exist?(out_path)
        raise FormatError, "pkcs12 export failed status=#{status.exitstatus}"
      end
      File.chmod(0o600, out_path)
    end
  end

  def unwrap_pkcs12(p12_path, password, pem_path)
    raise FormatError, "pkcs12 password is empty" if password.to_s.empty?
    _out, _err, status = Open3.capture3(
      { UNWRAP_ENV => password },
      openssl_bin, "pkcs12",
      *pkcs12_flags,
      "-in", p12_path,
      "-nodes",
      "-passin", "env:#{UNWRAP_ENV}",
      "-out", pem_path
    )
    unless status.success? && File.file?(pem_path) && !File.empty?(pem_path)
      File.delete(pem_path) if File.exist?(pem_path)
      raise FormatError, "pkcs12 unwrap failed status=#{status.exitstatus}"
    end
    File.chmod(0o600, pem_path)
  end

  # openssl pkcs12 -nodes writes Bag Attributes around the PEM blocks.
  # security import of that PEM keeps the certificate and drops the
  # private key. An empty passphrase makes the same import fail. The
  # keychain receives the PKCS#12 itself.
  def pem_blocks(text, label)
    blocks = []
    needle = "-----BEGIN #{label}-----"
    closer = "-----END #{label}-----"
    start = 0
    while (begin_at = text.index(needle, start))
      end_at = text.index(closer, begin_at)
      break unless end_at
      finish = end_at + closer.length
      newline = text.index("\n", finish)
      block = newline ? text.byteslice(begin_at..newline) : text.byteslice(begin_at, finish - begin_at)
      block = block.b
      block += "\n" unless block.end_with?("\n")
      blocks << block
      start = finish
    end
    blocks
  end

  def identity_part_counts(pem_path)
    text = File.binread(pem_path)
    keys = pem_blocks(text, "PRIVATE KEY").length
    keys += pem_blocks(text, "RSA PRIVATE KEY").length
    keys += pem_blocks(text, "EC PRIVATE KEY").length
    [keys, pem_blocks(text, "CERTIFICATE").length]
  end

  # The password is an argument of this one child and is never printed.
  # security(1) has no other way to receive a PKCS#12 passphrase.
  def import_pkcs12(p12_path, password, keychain_path)
    raise FormatError, "pkcs12 password is empty" if password.to_s.empty?
    _out, err, status = Open3.capture3(
      "/usr/bin/security", "import", p12_path,
      "-k", keychain_path,
      "-P", password,
      "-A",
      "-T", "/usr/bin/codesign",
      "-T", "/usr/bin/security",
      "-T", "/usr/bin/productbuild",
      "-T", "/usr/bin/productsign"
    )
    code = status.exitstatus || 1
    return if code.zero?
    raise FormatError, "security import failed status=#{code} detail=#{scrub_security(err, password)}"
  rescue Errno::ENOENT
    raise FormatError, "security import failed status=127 detail="
  end

  def scrub_security(text, secret = nil)
    hidden = secret.to_s
    text.to_s.lines.each do |raw|
      line = raw.strip.gsub(/\s+/, " ")
      next if line.empty?
      next if line.include?("-----")
      next if !hidden.empty? && line.include?(hidden)
      return line.slice(0, 160).to_s
    end
    ""
  end

  # find-key misses private keys that dump-keychain lists, and
  # find-identity hides a self-signed certificate that is not in the
  # trust store. Only the class tokens are kept. The dump is not logged.
  def keychain_report(keychain)
    out, _err, status = Open3.capture3("/usr/bin/security", "dump-keychain", keychain)
    classes = []
    if status.success?
      out.to_s.scan(/^\s*class:\s+(\S+)/).flatten.each do |token|
        next unless token.match?(/\A(?:"[A-Za-z0-9_]+"|[A-Za-z0-9_]+|0x[0-9a-fA-F]{1,16})\z/)
        classes << token.delete('"')
      end
    end
    priv = classes.count { |token| token == "0x00000010" || token == "keys" }
    [priv, classes.uniq.sort.join(",")]
  rescue Errno::ENOENT
    [0, ""]
  end

  # Unwrap to prove the file holds one key and one certificate, then
  # import the PKCS#12 into a throwaway keychain when security(1) exists.
  # The previous default keychain and search list are restored before
  # this returns. The import command is not printed.
  def verify_reusable!(p12_path, password)
    Dir.mktmpdir("dist-p12-verify") do |dir|
      pem_path = File.join(dir, "identity.pem")
      unwrap_pkcs12(p12_path, password, pem_path)
      counts = identity_part_counts(pem_path)
      raise FormatError, "unwrapped identity parts=#{counts.join("/")}" unless counts == [1, 1]
      verify_in_temp_keychain!(p12_path, password) if File.executable?("/usr/bin/security")
    end
  end

  def verify_in_temp_keychain!(p12_path, password)
    previous_default = security_paths(security_stdout(["/usr/bin/security", "default-keychain"])).first
    previous_list = security_paths(security_stdout(["/usr/bin/security", "list-keychains", "-d", "user"]))
    name = "gm#{SecureRandom.hex(8)}"
    kc_password = SecureRandom.hex(24)
    created = nil
    succeeded = false
    list_status = 0
    default_status = 0
    begin
      status = security_status(["/usr/bin/security", "create-keychain", "-p", kc_password, name])
      raise FormatError, "temp keychain create failed status=#{status}" unless status.zero?
      created = locate_keychain(name)
      raise FormatError, "temp keychain missing" if created.nil?
      status = security_status(["/usr/bin/security", "set-keychain-settings", "-lut", "600", created])
      raise FormatError, "temp keychain settings failed status=#{status}" unless status.zero?
      status = security_status(["/usr/bin/security", "unlock-keychain", "-p", kc_password, created])
      raise FormatError, "temp keychain unlock failed status=#{status}" unless status.zero?
      status = security_status(["/usr/bin/security", "list-keychains", "-d", "user", "-s", created])
      raise FormatError, "temp keychain search list failed status=#{status}" unless status.zero?
      status = security_status(["/usr/bin/security", "default-keychain", "-s", created])
      raise FormatError, "temp keychain default failed status=#{status}" unless status.zero?
      import_pkcs12(p12_path, password, created)
      _part_out, part_err, part_status = Open3.capture3(
        "/usr/bin/security", "set-key-partition-list",
        "-S", "apple-tool:,apple:,codesign:",
        "-s",
        "-k", kc_password,
        created
      )
      part_code = part_status.exitstatus || 1
      unless part_code.zero?
        raise FormatError, "temp keychain partition failed status=#{part_code} detail=#{scrub_security(part_err, kc_password)}"
      end
      identities = identity_count(created)
      priv, classes = keychain_report(created)
      key_status = security_status(["/usr/bin/security", "find-key", "-a", created])
      cert_status = security_status(["/usr/bin/security", "find-certificate", "-a", created])
      usable = identities >= 1 || (cert_status.zero? && (priv >= 1 || key_status.zero?))
      unless usable
        raise FormatError, "temp keychain has no signing identity identities=#{identities} priv=#{priv} key=#{key_status} cert=#{cert_status} classes=#{classes}"
      end
      succeeded = true
    ensure
      list_status, default_status = restore_keychains(previous_default, previous_list)
      if created && File.basename(created).include?(name)
        security_status(["/usr/bin/security", "delete-keychain", created])
      end
    end
    if succeeded && !list_status.zero?
      raise FormatError, "temp keychain list restore failed status=#{list_status}"
    end
    if succeeded && !default_status.zero?
      raise FormatError, "temp keychain default restore failed status=#{default_status}"
    end
  end

  def locate_keychain(name)
    current = security_paths(security_stdout(["/usr/bin/security", "default-keychain"])).first
    if current && File.exist?(current) && File.basename(current).include?(name)
      return current
    end
    base = File.join(ENV.fetch("HOME", Dir.home), "Library", "Keychains")
    candidates = [
      File.join(base, name),
      File.join(base, "#{name}-db"),
      File.join(base, "#{name}.keychain"),
      File.join(base, "#{name}.keychain-db")
    ]
    found = candidates.find { |path| File.exist?(path) }
    return found if found
    current = security_paths(security_stdout(["/usr/bin/security", "default-keychain"])).first
    return nil if current.nil? || !File.exist?(current)
    return nil unless File.basename(current).include?(name)
    current
  end

  def restore_keychains(previous_default, previous_list)
    list_status = previous_list.nil? || previous_list.empty? ? 2 : 0
    default_status = previous_default.to_s.empty? ? 2 : 0
    if list_status.zero?
      list_status = security_status(["/usr/bin/security", "list-keychains", "-d", "user", "-s", *previous_list])
    end
    if default_status.zero?
      default_status = security_status(["/usr/bin/security", "default-keychain", "-s", previous_default])
    end
    [list_status, default_status]
  end

  def identity_count(keychain)
    out = security_stdout(["/usr/bin/security", "find-identity", "-p", "codesigning", "-v", keychain])
    out.scan(/^\s*\d+\)/).length
  end

  def security_paths(text)
    quoted = text.to_s.scan(/"([^"]+)"/).flatten
    return quoted unless quoted.empty?
    text.to_s.lines.map(&:strip).reject(&:empty?)
  end

  def security_stdout(cmd)
    out, _err, _status = Open3.capture3(*cmd)
    out.to_s
  rescue Errno::ENOENT
    ""
  end

  def security_status(cmd)
    _out, _err, status = Open3.capture3(*cmd)
    status.exitstatus || 1
  rescue Errno::ENOENT
    127
  end
end
