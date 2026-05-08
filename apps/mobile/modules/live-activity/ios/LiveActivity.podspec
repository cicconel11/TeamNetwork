require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LiveActivity'
  s.version        = package['version']
  s.summary        = package['description']
  s.license        = 'MIT'
  s.author         = 'TeamMeet'
  s.homepage       = 'https://www.myteamnetwork.com'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # Source files: the bridge module + a local copy of the
  # ActivityAttributes struct. The widget extension target compiles its
  # own copy from `targets/widget/EventActivityAttributes.swift`. The two
  # files MUST stay byte-identical; see the header comment in each.
  s.source_files = "**/*.{h,m,swift}"
end
