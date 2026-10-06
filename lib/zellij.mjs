export function parseSessions(output) {
  return output.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(line => line.trim()).map(line => {
    const match = line.trim().match(/^(.+?)\s+\[Created (.+?) ago\]\s*(.*)$/);
    if (!match) return { name: line.trim(), age: '', state: 'unknown' };
    const [, name, age, suffix] = match;
    return {
      name,
      age: age.replace(/(\d+)\s*years?/g, '$1y').replace(/(\d+)\s*months?/g, '$1mo')
        .replace(/(\d+)\s*days?/g, '$1d').replace(/(\d+)\s*hours?/g, '$1h')
        .replace(/(\d+)\s*minutes?/g, '$1m').replace(/(\d+)\s*seconds?/g, '$1s'),
      state: /\bEXITED\b/.test(suffix) ? 'exited' : /\(current\)/.test(suffix) ? 'current' : 'active',
    };
  });
}
