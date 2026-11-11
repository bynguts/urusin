// Panggilan LLM sisi eval (simulator warga + juri) langsung ke endpoint OpenAI-compatible yang sama dengan
// agen. Bukan lewat server Urusin. Kunci tidak pernah dicetak; pemakaian token dicatat untuk laporan biaya.

export class KlienLlm {
  constructor({ baseUrl, apiKey, model }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.pakai = { panggilan: 0, tokensIn: 0, tokensOut: 0 };
  }

  async chat(messages, { maxTokens = 800, temperature, timeoutMs = 120_000 } = {}) {
    let galat;
    for (let coba = 0; coba < 4; coba++) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: this.model,
            messages,
            max_tokens: maxTokens,
            stream: false,
            ...(temperature !== undefined ? { temperature } : {}),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`LLM HTTP ${res.status}`);
        if (!res.ok) throw Object.assign(new Error(`LLM HTTP ${res.status}`), { fatal: true });
        const j = bacaBalasan(await res.text());
        this.pakai.panggilan++;
        this.pakai.tokensIn += j.usage?.prompt_tokens ?? 0;
        this.pakai.tokensOut += j.usage?.completion_tokens ?? 0;
        return j.choices?.[0]?.message?.content ?? '';
      } catch (e) {
        galat = e;
        if (e.fatal) break;
        await new Promise((ok) => setTimeout(ok, 1500 * (coba + 1)));
      }
    }
    throw galat;
  }

  /** Minta JSON; ambil objek pertama yang valid dari balasan (toleran pagar ```json dan teks pembuka). */
  async json(messages, opsi) {
    for (let coba = 0; coba < 3; coba++) {
      const teks = await this.chat(messages, opsi);
      const obj = ambilJson(teks);
      if (obj) return obj;
      messages = [
        ...messages,
        { role: 'assistant', content: teks },
        { role: 'user', content: 'Balas HANYA dengan satu objek JSON valid sesuai format, tanpa teks lain.' },
      ];
    }
    throw new Error('LLM tidak mengembalikan JSON valid');
  }
}

/** Balasan JSON biasa, atau rangkaian SSE (beberapa proxy tetap streaming): gabungkan delta jadi satu pesan. */
export function bacaBalasan(teks) {
  if (!teks.trimStart().startsWith('data:')) return JSON.parse(teks);
  let isi = '';
  let usage;
  for (const baris of teks.split('\n')) {
    const d = baris.startsWith('data:') ? baris.slice(5).trim() : '';
    if (!d || d === '[DONE]') continue;
    const j = JSON.parse(d);
    isi += j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
    if (j.usage) usage = j.usage;
  }
  return { choices: [{ message: { content: isi } }], usage };
}

export function ambilJson(teks) {
  const s = String(teks ?? '').replace(/```(?:json)?/gi, '');
  for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
    let dalam = 0;
    let str = false;
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (str) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') str = false;
        continue;
      }
      if (c === '"') str = true;
      else if (c === '{') dalam++;
      else if (c === '}' && --dalam === 0) {
        try {
          return JSON.parse(s.slice(i, j + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}
