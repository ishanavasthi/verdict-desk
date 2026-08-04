import { EventEmitter } from 'events';
import { CappedCollector } from '../src/sandbox/capped-collector';

describe('CappedCollector', () => {
  it('retains everything when total bytes stay under the cap', () => {
    const c = new CappedCollector({ capBytes: 100 });
    c.push(Buffer.from('hello '));
    c.push(Buffer.from('world'));
    expect(c.text()).toBe('hello world');
    expect(c.truncated).toBe(false);
    expect(c.totalSeenBytes).toBe(11);
    expect(c.storedBytes).toBe(11);
  });

  it('caps storage at exactly capBytes and flips truncated once exceeded', () => {
    const c = new CappedCollector({ capBytes: 5 });
    c.push(Buffer.from('abc')); // 3 stored, not yet truncated (== not >)
    expect(c.truncated).toBe(false);
    c.push(Buffer.from('defgh')); // total seen 8 > cap 5 -> truncated, only 2 more bytes stored
    expect(c.truncated).toBe(true);
    expect(c.storedBytes).toBe(5);
    expect(c.text()).toBe('abcde');
    expect(c.totalSeenBytes).toBe(8);
  });

  it('keeps draining (accepting pushes) far beyond the cap without growing storage', () => {
    const c = new CappedCollector({ capBytes: 10 });
    for (let i = 0; i < 1000; i++) {
      c.push(Buffer.alloc(1024, 65)); // 1 KiB of 'A' per push, 1000 times
    }
    expect(c.storedBytes).toBe(10);
    expect(c.truncated).toBe(true);
    expect(c.totalSeenBytes).toBe(1000 * 1024);
    expect(c.text().length).toBe(10);
  });

  it('fires onExceeded exactly once, the moment the cap is first crossed', () => {
    let fired = 0;
    const c = new CappedCollector({ capBytes: 4, onExceeded: () => fired++ });
    c.push(Buffer.from('ab'));
    expect(fired).toBe(0);
    c.push(Buffer.from('cd')); // total 4 == cap, not yet > cap
    expect(fired).toBe(0);
    c.push(Buffer.from('e')); // total 5 > cap -> fires
    expect(fired).toBe(1);
    c.push(Buffer.from('more data after the cap'));
    c.push(Buffer.from('and more'));
    expect(fired).toBe(1); // still exactly once
  });

  it('reconstructs a multi-byte UTF-8 character split across chunk boundaries', () => {
    // Snowman U+2603 encodes as 3 UTF-8 bytes: 0xE2 0x98 0x83. Split the write
    // across two chunks so no single push() call contains a whole codepoint.
    const full = Buffer.from('x☃y', 'utf8');
    expect(full.length).toBe(5); // 'x' + 3-byte snowman + 'y'

    const c = new CappedCollector({ capBytes: 100 });
    c.push(full.subarray(0, 2)); // 'x' + first byte of snowman
    c.push(full.subarray(2)); // remaining 2 bytes of snowman + 'y'

    expect(c.text()).toBe('x☃y');
  });

  it('handles a zero-byte cap: nothing stored, truncates on the first byte', () => {
    let fired = 0;
    const c = new CappedCollector({ capBytes: 0, onExceeded: () => fired++ });
    c.push(Buffer.from('a'));
    expect(c.storedBytes).toBe(0);
    expect(c.truncated).toBe(true);
    expect(fired).toBe(1);
    expect(c.text()).toBe('');
  });

  it('attach() drains a real Readable-like stream via its data event', () => {
    const capBytes = 3;
    const c = new CappedCollector({ capBytes });
    const emitter = new EventEmitter();
    c.attach(emitter as unknown as import('stream').Readable);

    emitter.emit('data', Buffer.from('abcdef'));
    expect(c.text()).toBe('abc');
    expect(c.truncated).toBe(true);
  });
});
