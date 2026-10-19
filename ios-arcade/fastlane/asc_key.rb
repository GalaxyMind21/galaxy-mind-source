# Normalize an App Store Connect .p8 into a canonical PEM private key.
# Twin of scripts/asc_key.py. Failure text is lengths and booleans only.
require "base64"

module AscKey
  HEADER = "-----BEGIN PRIVATE KEY-----".freeze
  FOOTER = "-----END PRIVATE KEY-----".freeze
  MARKER = /-{5}\s*BEGIN\s+PRIVATE\s+KEY\s*-{5}(.*?)-{5}\s*END\s+PRIVATE\s+KEY\s*-{5}/m

  class FormatError < StandardError
  end

  module_function

  def unescape(text)
    text.to_s.gsub("\\r\\n", "\n").gsub("\\n", "\n").gsub("\\r", "\n")
  end

  def bom?(text)
    text.start_with?("\uFEFF") || text.sub(/\A[ \t\r\n]+/, "").start_with?("\uFEFF")
  end

  def drop_bom(text)
    return text[1..] if text.start_with?("\uFEFF")
    stripped = text.sub(/\A[ \t\r\n]+/, "")
    lead = text.length - stripped.length
    return text[0, lead] + stripped[1..] if stripped.start_with?("\uFEFF")
    text
  end

  def prepare(text)
    unescape(drop_bom(text.to_s))
  end

  def alphabet(body)
    body.to_s.gsub(%r{[^A-Za-z0-9+/=]}, "").delete("=")
  end

  def bool_s(value)
    value ? "true" : "false"
  end

  def diag(original, body, decoded_utf8, der)
    searched = prepare(original)
    raw = alphabet(body)
    parts = [
      "len=#{original.length}",
      "bom=#{bool_s(bom?(original))}",
      "has_begin=#{bool_s(searched.include?(HEADER))}",
      "has_end=#{bool_s(searched.include?(FOOTER))}",
      "has_begin_words=#{bool_s(searched.include?('BEGIN PRIVATE KEY'))}",
      "has_end_words=#{bool_s(searched.include?('END PRIVATE KEY'))}",
      "decoded_utf8=#{bool_s(decoded_utf8)}",
      "body_len=#{raw.length}",
      "mod4=#{raw.length % 4}",
      "der=#{bool_s(der)}"
    ]
    "ASC key PEM unusable #{parts.join(' ')}"
  end

  def b64_error(secret, raw)
    "ASC_KEY_P8 is not valid base64 len=#{secret.length} body_len=#{raw.length} mod4=#{raw.length % 4}"
  end

  def asn1_header_size(data)
    return nil if data.bytesize < 2 || data.getbyte(0) != 0x30
    n = data.getbyte(1)
    return 2 if n < 0x80
    nbytes = n & 0x7F
    return nil if nbytes == 0 || nbytes > 3 || data.bytesize < 2 + nbytes
    2 + nbytes
  end

  def asn1_total(data)
    header = asn1_header_size(data)
    return nil if header.nil? || data.bytesize < 2
    n = data.getbyte(1)
    return 2 + n if n < 0x80
    nbytes = n & 0x7F
    length = 0
    nbytes.times { |i| length = (length << 8) + data.getbyte(2 + i) }
    header + length
  end

  def pkcs8_der?(data)
    return false if data.bytesize < 8 || data.getbyte(0) != 0x30
    header = asn1_header_size(data)
    total = asn1_total(data)
    return false if header.nil? || total != data.bytesize
    return false if header + 2 >= data.bytesize
    data.getbyte(header) == 0x02 && data.getbyte(header + 1) == 1 && data.getbyte(header + 2) == 0x00
  end

  def wrap(der)
    body = Base64.strict_encode64(der)
    lines = body.scan(/.{1,64}/)
    "#{HEADER}\n#{lines.join("\n")}\n#{FOOTER}\n"
  end

  # strict_decode64 rejects non-zero padding bits that Python's validate=True
  # accepts. Alphabet and padding were already checked, so the loose unpack
  # is the same decode.
  def decode64(padded)
    Base64.strict_decode64(padded)
  rescue ArgumentError
    decoded = padded.unpack1("m")
    raise ArgumentError if decoded.nil?
    decoded
  end

  def decode_body(original, body)
    raw = alphabet(body)
    raise FormatError, diag(original, body, true, false) if raw.empty? || raw.length % 4 == 1
    padded = raw + ("=" * ((4 - raw.length % 4) % 4))
    begin
      decoded = decode64(padded)
    rescue ArgumentError
      raise FormatError, diag(original, body, true, false)
    end
    raise FormatError, "ASC key file is empty" if decoded.nil? || decoded.empty?
    raise FormatError, diag(original, body, true, false) unless pkcs8_der?(decoded.b)
    decoded.b
  end

  def canonical_pem(secret)
    searched = prepare(secret)
    match = MARKER.match(searched)
    raise FormatError, diag(secret, "", true, false) if match.nil?
    wrap(decode_body(secret, match[1]))
  end

  def looks_like_pem?(text)
    searched = prepare(text)
    !MARKER.match(searched).nil? || searched.include?("BEGIN PRIVATE KEY")
  end

  def as_utf8(secret)
    raw = secret.nil? ? +"" : secret.to_s.dup
    raw.force_encoding(Encoding::UTF_8)
    return raw if raw.valid_encoding?
    raw.force_encoding(Encoding::ASCII_8BIT).encode(Encoding::UTF_8, invalid: :replace, undef: :replace, replace: "")
  end

  def normalize(secret)
    secret = as_utf8(secret)
    raise FormatError, "ASC_KEY_P8 is empty" if secret.delete(" \t\r\n\uFEFF").empty?
    return [canonical_pem(secret), "pem"] if looks_like_pem?(secret)
    raw = alphabet(secret)
    raise FormatError, b64_error(secret, raw) if raw.empty? || raw.length % 4 == 1
    padded = raw + ("=" * ((4 - raw.length % 4) % 4))
    begin
      decoded = decode64(padded)
    rescue ArgumentError
      raise FormatError, b64_error(secret, raw)
    end
    raise FormatError, "ASC key file is empty" if decoded.nil? || decoded.empty?
    decoded = decoded.b
    utf8 = true
    text = ""
    begin
      text = decoded.dup.force_encoding(Encoding::UTF_8)
      raise ArgumentError unless text.valid_encoding?
    rescue ArgumentError
      utf8 = false
      text = ""
    end
    return [canonical_pem(text), "base64"] if utf8 && looks_like_pem?(text)
    return [wrap(decoded), "der"] if pkcs8_der?(decoded)
    raise FormatError, diag(secret, raw, utf8, false)
  end
end
