import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';

function commandStatus(command, args) {
  const res = spawnSync(command, args, { stdio: 'ignore' });
  return res.status === 0;
}

function main() {
  if (process.platform !== 'linux') {
    console.log('dialout setup is only needed on Linux.');
    process.exit(0);
  }

  const { username } = userInfo();
  const user = process.env.USER || username;
  if (!user) {
    console.error('Could not determine current user.');
    process.exit(1);
  }

  const dialoutExists = commandStatus('getent', ['group', 'dialout']);

  // Avoid shell pipelines; check membership via `id -nG`.
  const res = spawnSync('id', ['-nG', user], { encoding: 'utf8', stdio: 'pipe' });
  const groups = (res.stdout || '').toString();
  const inDialout = groups.split(/\s+/).includes('dialout');

  if (!dialoutExists) {
    const grp = spawnSync('sudo', ['groupadd', 'dialout'], { stdio: 'inherit' });
    if (grp.status !== 0) process.exit(grp.status ?? 1);
  }

  if (inDialout) {
    console.log(`User ${user} is already in dialout.`);
    process.exit(0);
  }

  const add = spawnSync('sudo', ['usermod', '-a', '-G', 'dialout', user], { stdio: 'inherit' });
  if (add.status !== 0) process.exit(add.status ?? 1);

  console.log(`Added ${user} to dialout. Re-login (or reboot) for group membership to apply.`);
}

main();
