#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')

main()

function main() {
  const { conanfile, outputFolder, packages, installCommand } = parseArgs(
    process.argv.slice(2)
  )
  const requirements = readRequirements(conanfile)
  const selectedRequirements = selectRequirements(requirements, packages)
  const stamp = buildStamp(conanfile, selectedRequirements)
  const stampPath = path.join(
    outputFolder,
    '.omega-edit-conan-requirements.json'
  )

  if (isOutputFolderStale(outputFolder, stampPath, stamp)) {
    console.log(
      `Conan requirements changed for ${path.relative(repoRoot, conanfile)}; removing ${path.relative(repoRoot, outputFolder)}.`
    )
    fs.rmSync(outputFolder, { recursive: true, force: true })
  }

  removeMismatchedCachedRequirements(selectedRequirements)
  run(installCommand[0], installCommand.slice(1), process.cwd())

  fs.mkdirSync(outputFolder, { recursive: true })
  fs.writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`)
}

function parseArgs(args) {
  let conanfile = ''
  let outputFolder = ''
  const packages = []
  const separatorIndex = args.indexOf('--')

  if (separatorIndex < 0) {
    fail('Expected "--" followed by the conan install command.')
  }

  const options = args.slice(0, separatorIndex)
  const installCommand = args.slice(separatorIndex + 1)
  if (installCommand.length === 0) {
    fail('Missing conan install command after "--".')
  }

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index]
    if (option === '--conanfile') {
      conanfile = path.resolve(readOptionValue(options, (index += 1), option))
    } else if (option === '--output-folder') {
      outputFolder = path.resolve(
        readOptionValue(options, (index += 1), option)
      )
    } else if (option === '--package') {
      packages.push(readOptionValue(options, (index += 1), option))
    } else {
      fail(`Unknown option: ${option}`)
    }
  }

  if (!conanfile) {
    fail('Missing required --conanfile option.')
  }
  if (!outputFolder) {
    fail('Missing required --output-folder option.')
  }

  return {
    conanfile,
    outputFolder,
    packages,
    installCommand,
  }
}

function readOptionValue(options, index, option) {
  const value = options[index]
  if (!value || value.startsWith('--')) {
    fail(`Missing value for ${option}.`)
  }

  return value
}

function readRequirements(conanfile) {
  const source = fs.readFileSync(conanfile, 'utf8')
  const requirements = new Map()
  const requirePattern = /self\.requires\(\s*["']([^"']+)["']/g
  let match = requirePattern.exec(source)

  while (match) {
    const ref = match[1]
    const parsed = parseConanRef(ref)
    requirements.set(parsed.name, { ...parsed, ref })
    match = requirePattern.exec(source)
  }

  if (requirements.size === 0) {
    fail(`No self.requires(...) entries found in ${conanfile}.`)
  }

  return requirements
}

function parseConanRef(ref) {
  const match = ref.match(/^([^/\s]+)\/([^@#:\s]+)/)
  if (!match) {
    fail(`Unsupported Conan requirement reference: ${ref}`)
  }

  return {
    name: match[1],
    version: match[2],
  }
}

function selectRequirements(requirements, packages) {
  const names = packages.length > 0 ? packages : [...requirements.keys()]
  return names.map((name) => {
    const requirement = requirements.get(name)
    if (!requirement) {
      fail(`Package "${name}" was not found in the Conan requirements.`)
    }

    return requirement
  })
}

function buildStamp(conanfile, requirements) {
  return {
    conanfile: path.relative(repoRoot, conanfile),
    requirements: requirements
      .map(({ name, ref, version }) => ({ name, ref, version }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  }
}

function isOutputFolderStale(outputFolder, stampPath, expectedStamp) {
  if (!fs.existsSync(outputFolder)) {
    return false
  }

  if (!fs.existsSync(stampPath)) {
    return true
  }

  try {
    const currentStamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'))
    return JSON.stringify(currentStamp) !== JSON.stringify(expectedStamp)
  } catch {
    return true
  }
}

function removeMismatchedCachedRequirements(requirements) {
  for (const requirement of requirements) {
    const cachedRefs = listCachedRefs(requirement.name)
    const mismatchedRefs = cachedRefs.filter((ref) => {
      const cached = parseConanRef(ref)
      return (
        cached.name === requirement.name &&
        cached.version !== requirement.version
      )
    })

    for (const ref of mismatchedRefs) {
      console.log(
        `Removing cached Conan recipe ${ref}; ${requirement.ref} is required.`
      )
      run('conan', ['remove', ref, '--confirm'], process.cwd())
    }
  }
}

function listCachedRefs(packageName) {
  const result = runMaybe(
    'conan',
    ['list', `${packageName}/*`, '--cache', '--format=json'],
    process.cwd(),
    { stdio: 'pipe' }
  )
  if (result.error || result.status !== 0) {
    return []
  }

  const data = parseJsonOutput(`${result.stdout || ''}${result.stderr || ''}`)
  return Object.keys(data['Local Cache'] || {})
}

function parseJsonOutput(output) {
  const jsonStart = output.indexOf('{')
  if (jsonStart < 0) {
    return {}
  }

  try {
    return JSON.parse(output.slice(jsonStart))
  } catch {
    return {}
  }
}

function run(command, args, cwd) {
  const result = runMaybe(command, args, cwd)
  if (result.error) {
    console.error(result.error)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function runMaybe(command, args, cwd, options = {}) {
  console.log(`\n> ${formatCommand(command, args)}`)
  return spawnSync(resolveCommand(command), args, {
    cwd,
    stdio: options.stdio || 'inherit',
    shell: false,
    encoding: options.stdio === 'pipe' ? 'utf8' : undefined,
  })
}

function resolveCommand(command) {
  if (process.platform !== 'win32') {
    return command
  }

  if (command === 'conan') {
    return 'conan.exe'
  }

  return command
}

function formatCommand(command, args) {
  return [command, ...args.map(formatArg)].join(' ')
}

function formatArg(arg) {
  if (!/\s/.test(arg)) {
    return arg
  }

  return `"${arg.replaceAll('"', '\\"')}"`
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
