# frozen_string_literal: true

# Validates every fastlane action hash the TestFlight lanes pass, using
# fastlane 2.228's own Configuration.create. A key present as false still
# conflicts. Run from ios-arcade with `bundle exec ruby scripts/test-lane-options.rb`.

require "fileutils"
require "tmpdir"

root = File.expand_path("..", __dir__)
Dir.chdir(root)

begin
  require "fastlane"
rescue LoadError
  if ENV["CI"] || ENV["GITHUB_ACTIONS"]
    warn "fastlane not installed; lane option audit skipped"
    exit 0
  end
  raise
end

unless Fastlane::VERSION == "2.228.0"
  abort "expected fastlane 2.228.0, found #{Fastlane::VERSION}"
end

Fastlane::Actions.load_default_actions

def accept(label, action, params)
  options = action.available_options
  if options.nil?
    abort "#{label} declares no options but was passed #{params.inspect}" unless params.empty?
    puts "ok #{label} (no options)"
    return nil
  end
  config = FastlaneCore::Configuration.create(options, params)
  puts "ok #{label}"
  config
rescue StandardError => e
  abort "FAIL #{label}: #{e.class}: #{e.message}"
end

def reject(label, action, params, pattern)
  options = action.available_options
  FastlaneCore::Configuration.create(options, params)
  abort "FAIL #{label}: expected a conflict"
rescue StandardError => e
  detail = "#{e.class}: #{e.message}"
  abort "FAIL #{label}: #{detail}" unless detail.match?(pattern)
  puts "ok #{label} rejected"
end

api_key = {
  key_id: "ABCDE12345",
  issuer_id: "00000000-0000-0000-0000-000000000000",
  key: "not-a-real-key",
  is_key_content_base64: false,
  duration: 1200,
  in_house: false
}.freeze

key_file = File.join(Dir.tmpdir, "AuthKey_ABCDE12345.p8")
File.write(key_file, "not-a-real-key\n")
keychain = File.join(Dir.tmpdir, "lane-audit.keychain-db")
FileUtils.touch(keychain)
material = Dir.mktmpdir("lane-material")

begin
  accept("opt_out_usage", Fastlane::Actions::OptOutUsageAction, {})

  accept(
    "app_store_connect_api_key",
    Fastlane::Actions::AppStoreConnectApiKeyAction,
    {
      key_id: "ABCDE12345",
      issuer_id: "00000000-0000-0000-0000-000000000000",
      key_filepath: key_file,
      duration: 1200,
      in_house: false
    }
  )

  accept(
    "latest_testflight_build_number",
    Fastlane::Actions::LatestTestflightBuildNumberAction,
    {
      api_key: api_key,
      app_identifier: "space.galaxymind.arcade",
      version: "1.0.0",
      initial_build_number: 0,
      platform: "ios"
    }
  )

  accept("setup_ci", Fastlane::Actions::SetupCiAction, {})

  accept(
    "create_keychain",
    Fastlane::Actions::CreateKeychainAction,
    {
      name: "fastlane_tmp_keychain",
      password: "",
      default_keychain: true,
      unlock: true,
      timeout: 3600,
      lock_when_sleeps: true,
      add_to_search_list: true
    }
  )

  # cert's keychain verify_block refuses every path on Linux. The GitHub
  # runner is macOS, where the same path is a real keychain file.
  original_mac = FastlaneCore::Helper.method(:mac?)
  original_xcode = FastlaneCore::Helper.method(:xcode_at_least?)
  FastlaneCore::Helper.define_singleton_method(:mac?) { true }
  FastlaneCore::Helper.define_singleton_method(:xcode_at_least?) { |_version| true }
  begin
    accept(
      "get_certificates",
      Fastlane::Actions::GetCertificatesAction,
      {
        api_key: api_key,
        development: false,
        team_id: "ABCDE12345",
        keychain_path: keychain,
        keychain_password: "",
        output_path: material
      }
    )
  ensure
    FastlaneCore::Helper.define_singleton_method(:mac?) { original_mac.call }
    FastlaneCore::Helper.define_singleton_method(:xcode_at_least?) { |version| original_xcode.call(version) }
  end

  profile = accept(
    "get_provisioning_profile",
    Fastlane::Actions::GetProvisioningProfileAction,
    {
      api_key: api_key,
      app_identifier: "space.galaxymind.arcade",
      team_id: "ABCDE12345",
      cert_id: "CERTID123",
      output_path: material
    }
  )
  abort "adhoc was passed" if profile._values.key?(:adhoc) || profile._values.key?(:development)
  profile_type = "app-store"
  profile_type = "ad-hoc" if profile[:adhoc]
  profile_type = "development" if profile[:development]
  profile_type = "developer-id" if profile[:developer_id]
  abort "profile type #{profile_type}" unless profile_type == "app-store"

  reject(
    "get_provisioning_profile adhoc and development false",
    Fastlane::Actions::GetProvisioningProfileAction,
    {
      api_key: api_key,
      app_identifier: "space.galaxymind.arcade",
      adhoc: false,
      development: false,
      team_id: "ABCDE12345",
      cert_id: "CERTID123",
      output_path: material
    },
    /adhoc and development|development and :adhoc|can't enable both/
  )

  accept(
    "update_code_signing_settings",
    Fastlane::Actions::UpdateCodeSigningSettingsAction,
    {
      use_automatic_signing: false,
      path: "ios/App/App.xcodeproj",
      targets: ["App"],
      build_configurations: ["Release"],
      team_id: "ABCDE12345",
      code_sign_identity: "Apple Distribution",
      profile_name: "example"
    }
  )

  accept(
    "increment_build_number",
    Fastlane::Actions::IncrementBuildNumberAction,
    {
      build_number: "1",
      xcodeproj: "ios/App/App.xcodeproj"
    }
  )

  accept(
    "build_app",
    Fastlane::Actions::BuildAppAction,
    {
      workspace: "ios/App/App.xcworkspace",
      scheme: "App",
      configuration: "Release",
      export_method: "app-store",
      output_directory: "./build",
      skip_profile_detection: true,
      export_options: {
        method: "app-store",
        signingStyle: "manual",
        signingCertificate: "Apple Distribution",
        teamID: "ABCDE12345",
        provisioningProfiles: {
          "space.galaxymind.arcade" => "example"
        }
      }
    }
  )

  # upload_to_testflight and deliver register CLI flags through CommanderGenerator.
  # generate returns the ConfigItem array (Enumerable#each), so Configuration.create
  # still sees the lane hash. The fallback covers a generator that returns nil.
  pilot_options = Fastlane::Actions::UploadToTestflightAction.available_options
  if pilot_options.nil? || !pilot_options.first.is_a?(FastlaneCore::ConfigItem)
    require "pilot/options"
    pilot_options = Pilot::Options.available_options
    puts "note upload_to_testflight.available_options is not a ConfigItem list; using Pilot::Options"
  end
  FastlaneCore::Configuration.create(
    pilot_options,
    {
      api_key: api_key,
      app_identifier: "space.galaxymind.arcade",
      skip_waiting_for_build_processing: true,
      distribute_external: false,
      uses_non_exempt_encryption: false
    }
  )
  puts "ok upload_to_testflight"

  deliver_options = Fastlane::Actions::UploadToAppStoreAction.available_options
  if deliver_options.nil? || !deliver_options.first.is_a?(FastlaneCore::ConfigItem)
    require "deliver/options"
    deliver_options = Deliver::Options.available_options
    puts "note deliver.available_options is not a ConfigItem list; using Deliver::Options"
  end
  FastlaneCore::Configuration.create(deliver_options, { api_key: api_key })
  puts "ok deliver"

  src = File.read(File.join(root, "fastlane/Fastfile"))
  chunk = src[/def distribution_certificate_label\(cert\).*?^end/m]
  abort "distribution_certificate_label missing" unless chunk
  host = Object.new
  host.singleton_class.module_eval(chunk)
  cert = Struct.new(:display_name, :name, :expiration_date).new(
    "Apple Distribution: Example (ABCDE12345)",
    "",
    "2027-01-01T00:00:00Z"
  )
  def cert.valid?
    true
  end
  line = host.distribution_certificate_label(cert)
  abort "team id left in certificate label: #{line}" if line.include?("ABCDE12345")
  abort "certificate label missing expiry" unless line.include?("expires 2027-01-01T00:00:00Z expired=false")
  puts "ok distribution_certificate_label"
rescue SystemExit
  raise
ensure
  File.delete(key_file) if defined?(key_file) && key_file && File.exist?(key_file)
  File.delete(keychain) if defined?(keychain) && keychain && File.exist?(keychain)
  FileUtils.remove_entry(material) if defined?(material) && material && File.directory?(material)
end

puts "lane options ok"
