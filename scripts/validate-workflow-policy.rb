#!/usr/bin/env ruby
# frozen_string_literal: true

require 'yaml'

ROOT = File.expand_path('..', __dir__)
WORKFLOW_DIR = File.join(ROOT, '.github', 'workflows')
SHA_REF = /\A[0-9a-f]{40}\z/

failures = []

def fail_policy(failures, message)
  failures << message
end

def load_workflow(path, failures)
  YAML.safe_load(File.read(path), permitted_classes: [], aliases: true) || {}
rescue Psych::Exception => e
  fail_policy(failures, "INVALID_YAML:#{path}:#{e.message}")
  {}
end

def trigger_names(document)
  raw = document['on'] || document[true]
  case raw
  when String then [raw]
  when Array then raw.map(&:to_s)
  when Hash then raw.keys.map(&:to_s)
  when NilClass then []
  else [raw.to_s]
  end.sort
end

def walk_scalars(value, path = [], &block)
  case value
  when Hash
    value.each { |key, child| walk_scalars(child, path + [key.to_s], &block) }
  when Array
    value.each_with_index { |child, index| walk_scalars(child, path + [index.to_s], &block) }
  else
    block.call(path, value)
  end
end

def external_action_reference?(reference)
  !reference.start_with?('./') && !reference.start_with?('docker://')
end

def validate_uses(reference, file, location, failures)
  unless reference.is_a?(String) && reference.include?('@')
    fail_policy(failures, "INVALID_ACTION_REFERENCE:#{file}:#{location}:#{reference.inspect}")
    return
  end
  return unless external_action_reference?(reference)

  ref = reference.split('@', 2).last
  fail_policy(failures, "UNPINNED_ACTION:#{file}:#{location}:#{reference}") unless SHA_REF.match?(ref)
end

workflow_files = Dir.glob(File.join(WORKFLOW_DIR, '*.{yml,yaml}')).sort
fail_policy(failures, 'NO_WORKFLOWS_FOUND') if workflow_files.empty?

manual_only = %w[
  deploy-staging.yml
  production-deploy.yml
  runtime-path-inventory.yml
  configure-release-protection.yml
  publish-image.yml
  cancel-stale-publish-runs.yml
].freeze

workflow_files.each do |file|
  relative = file.delete_prefix("#{ROOT}/")
  document = load_workflow(file, failures)
  triggers = trigger_names(document)

  if manual_only.include?(File.basename(file)) && triggers != ['workflow_dispatch']
    fail_policy(failures, "WORKFLOW_MUST_BE_MANUAL_ONLY:#{relative}:#{triggers.join(',')}")
  end

  walk_scalars(document) do |location, scalar|
    next unless scalar.is_a?(String)
    fail_policy(failures, "DYNAMIC_HOST_TRUST_FORBIDDEN:#{relative}:#{location.join('.')}") if scalar.include?('ssh-keyscan')
  end

  jobs = document['jobs']
  unless jobs.is_a?(Hash)
    fail_policy(failures, "WORKFLOW_JOBS_MISSING:#{relative}")
    next
  end

  jobs.each do |job_name, job|
    unless job.is_a?(Hash)
      fail_policy(failures, "INVALID_JOB:#{relative}:#{job_name}")
      next
    end

    validate_uses(job['uses'], relative, "jobs.#{job_name}.uses", failures) if job.key?('uses')
    steps = job['steps']
    next unless steps.is_a?(Array)

    steps.each_with_index do |step, index|
      next unless step.is_a?(Hash) && step.key?('uses')

      reference = step['uses']
      location = "jobs.#{job_name}.steps.#{index}.uses"
      validate_uses(reference, relative, location, failures)
      next unless reference.is_a?(String) && reference.start_with?('actions/checkout@')

      with = step['with']
      persist = with.is_a?(Hash) ? with['persist-credentials'] : nil
      unless persist == false || persist.to_s == 'false'
        fail_policy(failures, "CHECKOUT_MUST_DISABLE_PERSISTED_CREDENTIALS:#{relative}:#{location}")
      end
    end
  end
end

release_path = File.join(WORKFLOW_DIR, 'release-readiness.yml')
if File.file?(release_path)
  release_doc = load_workflow(release_path, failures)
  walk_scalars(release_doc) do |location, scalar|
    next unless scalar.is_a?(String)
    if scalar.match?(/(^|[;&|[:space:]])s(?:sh|cp)([[:space:]]|$)/)
      fail_policy(failures, "REMOTE_COMMAND_FORBIDDEN_IN_RELEASE_READINESS:#{location.join('.')}")
    end
  end
end

if failures.any?
  failures.each { |failure| warn "ERROR=#{failure}" }
  warn 'WORKFLOW_POLICY=FAIL'
  exit 1
end

puts 'WORKFLOW_POLICY=PASS'
puts "WORKFLOWS_PARSED=#{workflow_files.length}"
puts 'AUTOMATIC_REMOTE_DEPLOYMENT=ABSENT'
puts 'ACTION_REFS=PINNED'
puts 'CHECKOUT_CREDENTIAL_PERSISTENCE=DISABLED'
