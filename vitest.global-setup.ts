import fs from 'fs';
import os from 'os';
import path from 'path';

export default function setup(): () => void {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-test-home-'));
    fs.mkdirSync(path.join(home, 'logs'));
    process.env.FONTE_HOME = home;
    return () => fs.rmSync(home, { recursive: true, force: true });
}
