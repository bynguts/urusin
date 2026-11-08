type Rule = { allow: boolean; pattern: string };

function toRegex(pattern: string): RegExp {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc.endsWith('\\$') ? esc.slice(0, -2) + '$' : esc}`);
}

/** Parser robots.txt minimal (RFC 9309): grup per User-agent, Allow/Disallow, pencocokan terpanjang menang. */
export class Robots {
  private readonly rules: Rule[];

  constructor(text: string, userAgentToken: string) {
    const token = userAgentToken.toLowerCase();
    const groups: { agents: string[]; rules: Rule[] }[] = [];
    let cur: { agents: string[]; rules: Rule[] } | null = null;
    let lastWasAgent = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '').trim();
      const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1]!.toLowerCase();
      const val = m[2]!.trim();
      if (key === 'user-agent') {
        if (!lastWasAgent || !cur) {
          cur = { agents: [], rules: [] };
          groups.push(cur);
        }
        cur.agents.push(val.toLowerCase());
        lastWasAgent = true;
        continue;
      }
      lastWasAgent = false;
      if (cur && (key === 'allow' || key === 'disallow') && val !== '') {
        cur.rules.push({ allow: key === 'allow', pattern: val });
      }
    }
    const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
    const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
    this.rules = chosen.flatMap((g) => g.rules);
  }

  isAllowed(pathAndQuery: string): boolean {
    let best: { len: number; allow: boolean } | null = null;
    for (const r of this.rules) {
      if (!toRegex(r.pattern).test(pathAndQuery)) continue;
      const len = r.pattern.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
    }
    return best ? best.allow : true;
  }
}
