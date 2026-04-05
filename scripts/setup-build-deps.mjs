import { spawnSync } from 'node:child_process';

function commandStatus(command, args) {
  const res = spawnSync(command, args, { stdio: 'ignore' });
  return res.status === 0;
}

function main() {
  const platform = process.platform;

  if (platform === 'linux') {
    const useApt = commandStatus('apt-get', ['--version']);
    const useDnf = commandStatus('dnf', ['--version']);
    if (!useApt && !useDnf) {
      console.error(
        'No supported package manager found (expected apt-get or dnf). Install build tools and python3 manually.',
      );
      process.exit(1);
    }

    if (useApt) {
      const upd = spawnSync('sudo', ['apt-get', 'update'], {
        stdio: 'inherit',
      });
      if (upd.status !== 0) process.exit(upd.status ?? 1);
      const inst = spawnSync('sudo', ['apt-get', 'install', '-y', 'build-essential', 'python3'], {
        stdio: 'inherit',
      });
      if (inst.status !== 0) process.exit(inst.status ?? 1);
      console.log('Installed build-essential and python3 (apt-get).');
      process.exit(0);
    }

    const grp = spawnSync('sudo', ['dnf', 'groupinstall', '-y', 'Development Tools'], {
      stdio: 'inherit',
    });
    if (grp.status !== 0) process.exit(grp.status ?? 1);
    const inst = spawnSync('sudo', ['dnf', 'install', '-y', 'python3'], {
      stdio: 'inherit',
    });
    if (inst.status !== 0) process.exit(inst.status ?? 1);
    console.log('Installed build tools and python3 (dnf).');
    process.exit(0);
  }

  if (platform === 'darwin') {
    // Ensure Command Line Tools are installed so native builds can proceed.
    const ok = spawnSync('xcode-select', ['-p'], { stdio: 'ignore' });
    if (ok.status === 0) {
      console.log('xcode-select appears configured; build deps likely OK.');
      process.exit(0);
    }
    console.log('Installing Xcode Command Line Tools. Follow prompts if any...');
    const inst = spawnSync('xcode-select', ['--install'], { stdio: 'inherit' });
    process.exit(inst.status ?? 0);
    console.error(
      'Could not run xcode-select --install automatically. Install Xcode Command Line Tools manually.',
    );
    process.exit(1);
  }

  if (platform === 'win32') {
    // Native builds depend on the Visual Studio C++ toolchain.
    const whereCl = spawnSync('where', ['cl'], { stdio: 'ignore' });
    if (whereCl.status === 0) {
      console.log('MSVC compiler detected (cl). Build deps likely OK.');
      process.exit(0);
    }
    console.error(
      "Windows build deps not auto-installable here. Install Visual Studio Build Tools with 'Desktop development with C++'.",
    );
    process.exit(1);
  }

  console.error(`Unsupported platform: ${platform}`);
  process.exit(1);
}

main();
