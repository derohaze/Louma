/** Resolves with the fallback instead of hanging on a collector that stalls. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        window.clearTimeout(timer);
        resolve(fallback);
      });
  });
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Everything the graphics stack will say about itself: the driver-reported GPU identity, the limits
 * the driver exposes, and the extensions it supports.
 *
 * The GPU identity and its limits are the most machine-specific values a browser can be asked for,
 * and none of them is derived from the user agent — which is exactly why they anchor the machine
 * key. They are returned raw and hashed in one place, so the payload stays bounded.
 */
export interface WebglDetails {
  vendor: string | null;
  renderer: string | null;
  limitsHash: string | null;
  extensionsHash: string | null;
}

export const NO_WEBGL: WebglDetails = {
  vendor: null,
  renderer: null,
  limitsHash: null,
  extensionsHash: null,
};

export async function webglDetails(): Promise<WebglDetails> {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return NO_WEBGL;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const parameter = (name: number | undefined): string | null => {
      if (name === undefined) return null;
      try {
        const value = gl.getParameter(name);
        return value === null || value === undefined ? null : String(value).slice(0, 256);
      } catch {
        return null;
      }
    };
    const limitNames: (number | undefined)[] = [
      gl.MAX_TEXTURE_SIZE,
      gl.MAX_RENDERBUFFER_SIZE,
      gl.MAX_VIEWPORT_DIMS,
      gl.ALIASED_LINE_WIDTH_RANGE,
      gl.MAX_VERTEX_ATTRIBS,
      gl.MAX_VARYING_VECTORS,
      gl.MAX_TEXTURE_IMAGE_UNITS,
      gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS,
      gl.MAX_CUBE_MAP_TEXTURE_SIZE,
      gl.MAX_FRAGMENT_UNIFORM_VECTORS,
      gl.MAX_VERTEX_UNIFORM_VECTORS,
      // WebGL2-only: undefined on a WebGL1 context, where it is filtered out of the limit set.
      (gl as WebGLRenderingContext & Partial<WebGL2RenderingContext>).MAX_SAMPLES,
    ];
    const limits = limitNames
      .filter((name): name is number => name !== undefined)
      .map((name) => `${name}:${parameter(name) ?? "?"}`)
      .join("|");
    const extensions = (gl.getSupportedExtensions() ?? []).slice().sort().join(",");
    return {
      vendor: parameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
      renderer: parameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
      limitsHash: limits ? await sha256Hex(limits) : null,
      extensionsHash: extensions ? await sha256Hex(extensions) : null,
    };
  } catch {
    return NO_WEBGL;
  }
}

/**
 * WebGPU adapter identity, when the browser has it. A second, independent view of the GPU: the
 * adapter exposes vendor/architecture/device strings that WebGL does not.
 */
export async function webgpuSignature(): Promise<string | null> {
  try {
    const gpu = (
      navigator as Navigator & {
        gpu?: { requestAdapter?: () => Promise<{ info?: Record<string, unknown> } | null> };
      }
    ).gpu;
    if (!gpu?.requestAdapter) return "no-webgpu";
    const adapter = await gpu.requestAdapter();
    if (!adapter) return "no-webgpu";
    const info = adapter.info ?? {};
    const text = ["vendor", "architecture", "device", "description"]
      .map((key) => String(info[key] ?? ""))
      .join("~");
    return text.replace(/~/g, "") ? await sha256Hex(text) : "no-webgpu";
  } catch {
    return "webgpu-error";
  }
}

/**
 * The audio stack's own configuration: the sample rate and channel count the machine negotiated.
 *
 * This is a hardware property of the sound device that no user-agent edit touches, and it is what a
 * virtualized or headless machine most often reports differently.
 */
export function audioDeviceInfo(): { sampleRate: number | null; channels: number | null } {
  try {
    const Context =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return { sampleRate: null, channels: null };
    const context = new Context();
    const info = {
      sampleRate: typeof context.sampleRate === "number" ? context.sampleRate : null,
      channels:
        typeof context.destination?.channelCount === "number"
          ? context.destination.channelCount
          : null,
    };
    void context.close().catch(() => undefined);
    return info;
  } catch {
    return { sampleRate: null, channels: null };
  }
}

/**
 * Installed speech voices.
 *
 * The synth list is a property of the operating system's speech engine, so it separates machines
 * that agree on everything a browser normally exposes. Chromium fills it asynchronously, so an
 * empty list is waited for (bounded) rather than hashed — an empty hash would be shared by every
 * machine that answered too early.
 */
export async function speechVoicesSignature(): Promise<string | null> {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return "no-speech";
    const read = (): string =>
      (synth.getVoices() ?? [])
        .map((voice) => `${voice.name}/${voice.lang}/${voice.localService ? "l" : "r"}`)
        .sort()
        .join("|");
    let voices = read();
    if (!voices) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => resolve(), 400);
        synth.addEventListener(
          "voiceschanged",
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      voices = read();
    }
    return voices ? await sha256Hex(voices) : "no-speech";
  } catch {
    return "no-speech";
  }
}

/**
 * Which media formats this machine can actually decode. Codec support follows the installed platform
 * and its media stack, and — unlike the user agent — cannot be edited by an extension.
 */
export async function codecsSignature(): Promise<string | null> {
  try {
    const probe = document.createElement("video");
    const candidates = [
      'video/mp4; codecs="avc1.42E01E"',
      'video/mp4; codecs="avc1.4D401F"',
      'video/mp4; codecs="hvc1.1.6.L93.B0"',
      'video/mp4; codecs="av01.0.05M.08"',
      'video/webm; codecs="vp8"',
      'video/webm; codecs="vp9"',
      'video/webm; codecs="vp09.00.10.08"',
      "audio/mpeg",
      'audio/ogg; codecs="vorbis"',
      'audio/ogg; codecs="opus"',
      'audio/wav; codecs="1"',
      "audio/flac",
      'audio/mp4; codecs="mp4a.40.2"',
    ];
    // "probably" only: "maybe" is what a browser says when it is merely willing to try.
    const supported = candidates.filter((type) => probe.canPlayType(type) === "probably");
    return supported.length > 0 ? await sha256Hex(supported.join("|")) : "no-codecs";
  } catch {
    return "no-codecs";
  }
}

/**
 * The active keyboard layout, read as the characters a fixed set of physical keys produce: an
 * Arabic, AZERTY or QWERTY layout answers differently, and the answer comes from the OS.
 */
export async function keyboardLayoutSignature(): Promise<string | null> {
  try {
    const keyboard = (
      navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }
    ).keyboard;
    if (!keyboard?.getLayoutMap) return "no-keyboard";
    const layout = await keyboard.getLayoutMap();
    const keys = [
      "KeyQ",
      "KeyW",
      "KeyY",
      "KeyZ",
      "Semicolon",
      "Quote",
      "Comma",
      "Period",
      "Minus",
      "Equal",
      "BracketLeft",
      "BracketRight",
      "Backslash",
      "Slash",
      "Backquote",
      "IntlBackslash",
    ];
    return await sha256Hex(keys.map((key) => `${key}:${layout.get(key) ?? "?"}`).join("|"));
  } catch {
    return "no-keyboard";
  }
}

/** Plugins and MIME types as this engine exposes them (Chromium reports its fixed PDF entries). */
export async function pluginsSignature(): Promise<string | null> {
  try {
    const plugins = Array.from(navigator.plugins ?? [])
      .map((plugin) => plugin.name)
      .sort();
    return plugins.length > 0 ? await sha256Hex(plugins.join("|")) : "no-plugins";
  } catch {
    return "no-plugins";
  }
}

export async function mimeTypesSignature(): Promise<string | null> {
  try {
    const types = Array.from(navigator.mimeTypes ?? [])
      .map((type) => type.type)
      .sort();
    return types.length > 0 ? await sha256Hex(types.join("|")) : "no-plugins";
  } catch {
    return "no-plugins";
  }
}

/** The storage quota the origin was granted: a coarse platform- and profile-level trait. */
export async function storageQuota(): Promise<number | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return typeof estimate.quota === "number" ? estimate.quota : null;
  } catch {
    return null;
  }
}

export function hdrSupported(): boolean | null {
  try {
    return window.matchMedia("(dynamic-range: high)").matches;
  } catch {
    return null;
  }
}

export function canvasSignature(): string {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "no-canvas";
    ctx.textBaseline = "top";
    ctx.font = "16px Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 220, 40);
    ctx.fillStyle = "#069";
    ctx.fillText("Louma device check 123", 4, 8);
    ctx.strokeStyle = "#000";
    ctx.arc(180, 20, 12, 0, Math.PI * 2);
    ctx.stroke();
    return canvas.toDataURL().slice(0, 4096);
  } catch {
    return "canvas-error";
  }
}

/**
 * Renders a short tone through an OfflineAudioContext and hashes the samples.
 *
 * Audio output is processed by the platform's audio stack, so the same machine reproduces the same
 * tiny numeric differences while a different machine (or a virtualized one) does not. "no-audio"
 * tells the server the collector failed rather than that the device sounds like every other device.
 */
export async function audioSignature(): Promise<string | null> {
  try {
    const OfflineContext =
      window.OfflineAudioContext ??
      (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    if (!OfflineContext) return "no-audio";
    const context = new OfflineContext(1, 4096, 44100);
    const oscillator = context.createOscillator();
    const compressor = context.createDynamicsCompressor();
    oscillator.type = "triangle";
    oscillator.frequency.value = 10000;
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;
    oscillator.connect(compressor);
    compressor.connect(context.destination);
    oscillator.start(0);
    const buffer = await context.startRendering();
    const channel = buffer.getChannelData(0);
    let signature = "";
    for (let index = 3000; index < channel.length; index += 8) {
      signature += (channel[index] ?? 0).toFixed(7);
    }
    return await sha256Hex(signature);
  } catch {
    return "audio-error";
  }
}

/**
 * Detects installed fonts by measuring text width against three generic families.
 *
 * A machine's font set survives a browser change and a cookie wipe and is expensive to fake
 * consistently, which is what makes it worth one measurement per candidate.
 */
export async function fontsSignature(): Promise<string | null> {
  try {
    const candidates = [
      "Arial",
      "Calibri",
      "Cambria",
      "Consolas",
      "Courier New",
      "Georgia",
      "Impact",
      "Segoe UI",
      "Tahoma",
      "Times New Roman",
      "Trebuchet MS",
      "Verdana",
      "Noto Sans",
      "Roboto",
      "Inter",
      "Menlo",
      "Monaco",
      "Helvetica",
      "San Francisco",
    ];
    const bases = ["monospace", "sans-serif", "serif"];
    const sample = "mmmmmmmmmmlli Louma 0123456789";
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;";
    document.documentElement.appendChild(container);
    // One batched layout: every span is appended first and measured after, so the
    // ~60 reads below cost a single layout instead of one forced reflow each.
    // Metrics are identical to measuring one span at a time (same styles, and
    // nowrap means siblings never change each other's size).
    const families = [
      ...bases,
      ...candidates.flatMap((font) => bases.map((base) => `"${font}",${base}`)),
    ];
    const spans = families.map((family) => {
      const span = document.createElement("span");
      span.style.cssText = `font-family:${family};font-size:72px;line-height:normal;white-space:nowrap;`;
      span.textContent = sample;
      container.appendChild(span);
      return span;
    });
    const metrics = spans.map((span) => `${span.offsetWidth}x${span.offsetHeight}`);
    const baselines = metrics.slice(0, bases.length);
    const detected = candidates.filter((font, fontIndex) =>
      bases.some(
        (_, baseIndex) =>
          metrics[bases.length + fontIndex * bases.length + baseIndex] !== baselines[baseIndex],
      ),
    );
    container.remove();
    return await sha256Hex(detected.join("|"));
  } catch {
    return "fonts-error";
  }
}

export function colorGamut(): string | null {
  try {
    if (window.matchMedia("(color-gamut: rec2020)").matches) return "rec2020";
    if (window.matchMedia("(color-gamut: p3)").matches) return "p3";
    if (window.matchMedia("(color-gamut: srgb)").matches) return "srgb";
    return null;
  } catch {
    return null;
  }
}

/** Counts only: without permission `enumerateDevices` returns entries with empty labels. */
export async function mediaInputCounts(): Promise<{ audio: number | null; video: number | null }> {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return { audio: null, video: null };
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      audio: devices.filter((device) => device.kind === "audioinput").length,
      video: devices.filter((device) => device.kind === "videoinput").length,
    };
  } catch {
    return { audio: null, video: null };
  }
}

/** Chromium's client hints: the OS build, CPU architecture and pointer size; other engines do not. */
export async function clientHints(): Promise<{
  platformVersion: string | null;
  architecture: string | null;
  bitness: string | null;
}> {
  const empty = { platformVersion: null, architecture: null, bitness: null };
  try {
    const hints = (
      navigator as Navigator & {
        userAgentData?: {
          getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
        };
      }
    ).userAgentData;
    if (!hints?.getHighEntropyValues) return empty;
    const values = await hints.getHighEntropyValues(["platformVersion", "architecture", "bitness"]);
    const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
    return {
      platformVersion: text(values["platformVersion"]),
      architecture: text(values["architecture"]),
      bitness: text(values["bitness"]),
    };
  } catch {
    return empty;
  }
}

export function detectImpossibleUaPlatform(ua: string, platform: string): boolean {
  const lowerUa = ua.toLowerCase();
  const lowerPf = platform.toLowerCase();
  if (lowerPf.includes("iphone") && /windows|linux/.test(lowerUa)) return true;
  if (lowerPf.includes("win32") && /iphone|android/.test(lowerUa)) return true;
  return false;
}
