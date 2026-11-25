import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function loadCreateServer() {
  try {
    const req = createRequire(import.meta.resolve('astro'));
    const viteEntry = req.resolve('vite');
    const mod = await import(pathToFileURL(viteEntry).href);
    return mod.createServer;
  } catch {
    const mod = await import('vite');
    return mod.createServer;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let viteServer;
let gifEngine;
let webpEngine;
let videoEngine;
let gifencPkg;

before(async () => {
  const createServer = await loadCreateServer();
  viteServer = await createServer({
    root: rootDir,
    appType: 'custom',
    logLevel: 'silent',
    server: {
      middlewareMode: true,
      ws: false,
    },
    optimizeDeps: {
      noDiscovery: true,
    },
    ssr: {
      noExternal: ['gifenc'],
    },
  });

  gifEngine = await viteServer.ssrLoadModule('/src/lib/gif-engine.ts');
  webpEngine = await viteServer.ssrLoadModule('/src/lib/webp-engine.ts');
  videoEngine = await viteServer.ssrLoadModule('/src/lib/video-engine.ts');
  gifencPkg = await viteServer.ssrLoadModule('gifenc');
});

after(async () => {
  if (viteServer) {
    await viteServer.close();
  }
});

function buildMockWebp(chunks) {
  let payloadLen = 0;
  for (const c of chunks) {
    payloadLen += 8 + c.data.byteLength + (c.data.byteLength & 1);
  }
  const out = new Uint8Array(12 + payloadLen);
  out.set(Buffer.from('RIFF'), 0);
  new DataView(out.buffer).setUint32(4, out.byteLength - 8, true);
  out.set(Buffer.from('WEBP'), 8);

  let pos = 12;
  for (const c of chunks) {
    out.set(Buffer.from(c.fourCC), pos);
    new DataView(out.buffer).setUint32(pos + 4, c.data.byteLength, true);
    out.set(c.data, pos + 8);
    pos += 8 + c.data.byteLength + (c.data.byteLength & 1);
  }
  return out;
}

describe('Motor de WebP Animado (RFC 9649)', () => {
  it('rejeita buffers inválidos ou truncados em extractWebpFrameChunks', () => {
    assert.throws(() => webpEngine.extractWebpFrameChunks(new Uint8Array(4)), /muito curto/);
    assert.throws(
      () => webpEngine.extractWebpFrameChunks(Buffer.from('PNG_NOT_RIFF_1234')),
      /RIFF\/WEBP/
    );

    const truncated = Buffer.from('RIFF\x20\x00\x00\x00WEBPVP8 \x64\x00\x00\x00\x01\x02');
    assert.throws(() => webpEngine.extractWebpFrameChunks(truncated), /truncado/);

    const onlyMetadata = buildMockWebp([{ fourCC: 'EXIF', data: new Uint8Array([1, 2, 3, 4]) }]);
    assert.throws(() => webpEngine.extractWebpFrameChunks(onlyMetadata), /nenhum chunk de imagem/);
  });

  it('extrai ALPH + VP8 ordenados com padding par e ignora VP8X/EXIF', () => {
    const vp8Payload = new Uint8Array([10, 20, 30]); // ímpar (3 bytes) -> pad para 4
    const alphPayload = new Uint8Array([0, 1, 2, 3, 4]); // ímpar (5 bytes) -> pad para 6
    const synthetic = buildMockWebp([
      { fourCC: 'VP8X', data: new Uint8Array(10) },
      { fourCC: 'EXIF', data: new Uint8Array([9, 9]) },
      { fourCC: 'VP8 ', data: vp8Payload },
      { fourCC: 'ALPH', data: alphPayload },
    ]);

    const res = webpEngine.extractWebpFrameChunks(synthetic);
    assert.equal(res.hasAlpha, true);
    // Deve colocar ALPH antes de VP8 : (8 + 6) + (8 + 4) = 26 bytes
    assert.equal(res.chunks.byteLength, 26);
    assert.equal(Buffer.from(res.chunks.subarray(0, 4)).toString('ascii'), 'ALPH');
    assert.equal(Buffer.from(res.chunks.subarray(14, 18)).toString('ascii'), 'VP8 ');
  });

  it('detecta bit de alfa no header VP8L', () => {
    // Byte 0 = 0x2f, bits 1..4 uint32LE com bit 28 ligado (0x10000000)
    const vp8lWithAlpha = new Uint8Array([0x2f, 0x0f, 0x00, 0x00, 0x10, 0xaa]);
    const webpWithAlpha = buildMockWebp([{ fourCC: 'VP8L', data: vp8lWithAlpha }]);
    assert.equal(webpEngine.extractWebpFrameChunks(webpWithAlpha).hasAlpha, true);

    const vp8lOpaque = new Uint8Array([0x2f, 0x0f, 0x00, 0x00, 0x00, 0xaa]);
    const webpOpaque = buildMockWebp([{ fourCC: 'VP8L', data: vp8lOpaque }]);
    assert.equal(webpEngine.extractWebpFrameChunks(webpOpaque).hasAlpha, false);
  });

  it('gera cabeçalho RIFF, VP8X (0x12), ANIM (loop=0) e ANMF (0x03) com alinhamento par', () => {
    const fakeFrame = new Uint8Array([
      0x56, 0x50, 0x38, 0x20, // 'VP8 '
      0x03, 0x00, 0x00, 0x00, // size 3
      0x01, 0x02, 0x03, 0x00, // padded to 4
    ]);

    const muxed = webpEngine.muxAnimatedWebp(
      [{ chunks: fakeFrame, width: 32, height: 24, durationMs: 80 }],
      { width: 32, height: 24, loopCount: 0, hasAlpha: true }
    );

    const view = new DataView(muxed.buffer, muxed.byteOffset, muxed.byteLength);
    assert.equal(Buffer.from(muxed.subarray(0, 4)).toString('ascii'), 'RIFF');
    assert.equal(view.getUint32(4, true), muxed.byteLength - 8);
    assert.equal(Buffer.from(muxed.subarray(8, 12)).toString('ascii'), 'WEBP');

    // VP8X
    assert.equal(Buffer.from(muxed.subarray(12, 16)).toString('ascii'), 'VP8X');
    assert.equal(muxed[20], 0x12); // Alpha (0x10) | Animation (0x02)
    assert.equal(muxed[24] | (muxed[25] << 8) | (muxed[26] << 16), 31); // width - 1
    assert.equal(muxed[27] | (muxed[28] << 8) | (muxed[29] << 16), 23); // height - 1

    // ANIM
    assert.equal(Buffer.from(muxed.subarray(30, 34)).toString('ascii'), 'ANIM');
    assert.deepEqual(Array.from(muxed.subarray(38, 42)), [0, 0, 0, 0]);
    assert.equal(view.getUint16(42, true), 0);

    // ANMF
    assert.equal(Buffer.from(muxed.subarray(44, 48)).toString('ascii'), 'ANMF');
    assert.equal(muxed[44 + 23], 0x03); // Do not blend + Dispose to background
  });

  it('valida paridade com libwebp e round-trip dos frames extraídos dos chunks ANMF via ffmpeg', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polisher-webp-test-'));
    try {
      const colors = ['red@0.4', 'green@0.6', 'blue@0.8'];
      const muxInputs = [];

      for (let i = 0; i < colors.length; i++) {
        const framePath = path.join(tmpDir, `frame_${i}.webp`);
        execFileSync(
          'ffmpeg',
          [
            '-y',
            '-v',
            'error',
            '-f',
            'lavfi',
            '-i',
            `color=c=${colors[i]}:s=33x25:d=0.1,format=rgba`,
            '-frames:v',
            '1',
            '-vcodec',
            'libwebp',
            '-lossless',
            '0',
            framePath,
          ],
          { stdio: 'pipe' }
        );

        const rawBytes = new Uint8Array(fs.readFileSync(framePath));
        const extracted = webpEngine.extractWebpFrameChunks(rawBytes);
        assert.equal(extracted.hasAlpha, true);
        muxInputs.push({
          chunks: extracted.chunks,
          width: 33,
          height: 25,
          durationMs: 67,
        });
      }

      const animatedBytes = webpEngine.muxAnimatedWebp(muxInputs, {
        width: 33,
        height: 25,
        loopCount: 0,
        hasAlpha: true,
      });

      // 1. Paridade estrutural com WebP animado 33x25 gerado pelo libwebp oficial do ffmpeg
      const refAnimPath = path.join(tmpDir, 'ref_anim.webp');
      execFileSync(
        'ffmpeg',
        [
          '-y',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=c=red@0.4:s=33x25:d=0.3,format=rgba',
          '-vcodec',
          'libwebp',
          '-lossless',
          '0',
          '-loop',
          '0',
          '-r',
          '10',
          refAnimPath,
        ],
        { stdio: 'pipe' }
      );
      const refBytes = new Uint8Array(fs.readFileSync(refAnimPath));
      assert.equal(Buffer.from(refBytes.subarray(12, 16)).toString('ascii'), 'VP8X');
      assert.deepEqual(
        Array.from(animatedBytes.subarray(20, 30)),
        Array.from(refBytes.subarray(20, 30))
      );

      // 2. Percorre container RIFF do animatedBytes validando ANIM e os 3 ANMF até o último byte
      const view = new DataView(
        animatedBytes.buffer,
        animatedBytes.byteOffset,
        animatedBytes.byteLength
      );
      assert.equal(view.getUint32(4, true), animatedBytes.byteLength - 8);
      assert.equal(Buffer.from(animatedBytes.subarray(30, 34)).toString('ascii'), 'ANIM');
      assert.deepEqual(Array.from(animatedBytes.subarray(38, 42)), [0, 0, 0, 0]);
      assert.equal(view.getUint16(42, true), 0);

      let cursor = 44;
      const extractedAnmfPayloads = [];
      while (cursor + 8 <= animatedBytes.byteLength) {
        const fcc = Buffer.from(animatedBytes.subarray(cursor, cursor + 4)).toString('ascii');
        assert.equal(fcc, 'ANMF');
        const payloadSize = view.getUint32(cursor + 4, true);
        const headerOffset = cursor + 8;
        const wMinus1 =
          animatedBytes[headerOffset + 6] |
          (animatedBytes[headerOffset + 7] << 8) |
          (animatedBytes[headerOffset + 8] << 16);
        const hMinus1 =
          animatedBytes[headerOffset + 9] |
          (animatedBytes[headerOffset + 10] << 8) |
          (animatedBytes[headerOffset + 11] << 16);
        const duration =
          animatedBytes[headerOffset + 12] |
          (animatedBytes[headerOffset + 13] << 8) |
          (animatedBytes[headerOffset + 14] << 16);
        assert.equal(wMinus1 + 1, 33);
        assert.equal(hMinus1 + 1, 25);
        assert.equal(duration, 67);
        assert.equal(animatedBytes[headerOffset + 15], 0x03);

        const subchunks = animatedBytes.subarray(headerOffset + 16, headerOffset + payloadSize);
        extractedAnmfPayloads.push(subchunks);
        cursor += 8 + payloadSize + (payloadSize & 1);
      }
      assert.equal(cursor, animatedBytes.byteLength);
      assert.equal(extractedAnmfPayloads.length, 3);

      // 3. Round-trip real de cada frame extraído dos ANMF decodificado via ffmpeg + ffprobe
      for (let i = 0; i < extractedAnmfPayloads.length; i++) {
        const subchunks = extractedAnmfPayloads[i];
        const subPad = subchunks.byteLength & 1;
        const singleWebp = new Uint8Array(12 + 18 + subchunks.byteLength + subPad);
        const sView = new DataView(singleWebp.buffer);
        singleWebp.set(Buffer.from('RIFF'), 0);
        sView.setUint32(4, singleWebp.byteLength - 8, true);
        singleWebp.set(Buffer.from('WEBP'), 8);
        singleWebp.set(Buffer.from('VP8X'), 12);
        sView.setUint32(16, 10, true);
        singleWebp[20] = 0x10; // Alpha flag apenas (frame estático)
        singleWebp.set(animatedBytes.subarray(24, 30), 24); // width-1 e height-1 (33x25)
        singleWebp.set(subchunks, 30);

        const singlePath = path.join(tmpDir, `anmf_frame_${i}.webp`);
        const pngPath = path.join(tmpDir, `decoded_${i}.png`);
        fs.writeFileSync(singlePath, singleWebp);

        execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', singlePath, pngPath], {
          stdio: 'pipe',
        });

        const probeJson = execFileSync(
          'ffprobe',
          ['-v', 'error', '-show_streams', '-of', 'json', pngPath],
          { encoding: 'utf8' }
        );
        const parsed = JSON.parse(probeJson);
        assert.equal(parsed.streams[0].width, 33);
        assert.equal(parsed.streams[0].height, 25);
        assert.equal(parsed.streams[0].pix_fmt, 'rgba');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Motor de GIF com Dithering Floyd-Steinberg', () => {
  it('preserva dimensões, não muta o buffer original e reduz erro médio em gradientes', () => {
    const width = 48;
    const height = 24;
    const rgba = new Uint8ClampedArray(width * height * 4);

    // Gradiente suave de cinza/roxo onde quantização seca sofre banding forte
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const t = x / (width - 1);
        rgba[idx] = Math.round(20 + t * 210);
        rgba[idx + 1] = Math.round(15 + t * 140);
        rgba[idx + 2] = Math.round(40 + t * 190);
        rgba[idx + 3] = 255;
      }
    }

    const originalCopy = new Uint8ClampedArray(rgba);
    // Paleta esparsa de 8 níveis para evidenciar o efeito do dithering
    const palette = Array.from({ length: 8 }, (_, i) => {
      const t = i / 7;
      return [
        Math.round(20 + t * 210),
        Math.round(15 + t * 140),
        Math.round(40 + t * 190),
      ];
    });

    const dithered = gifEngine.applyPaletteWithDithering(rgba, width, height, palette);
    const flat = gifencPkg.applyPalette(rgba, palette, 'rgb565');

    assert.equal(dithered.length, width * height);
    assert.deepEqual(rgba, originalCopy);
    for (let i = 0; i < dithered.length; i++) {
      assert.ok(dithered[i] < palette.length);
    }

    // Mede erro médio por bloco 4x4 (métrica perceptual de fidelidade tonal em dithering)
    function blockLumaError(indices) {
      let totalErr = 0;
      let blocks = 0;
      for (let by = 0; by < height; by += 4) {
        for (let bx = 0; bx < width; bx += 4) {
          let srcSum = 0;
          let outSum = 0;
          for (let dy = 0; dy < 4; dy++) {
            for (let dx = 0; dx < 4; dx++) {
              const p = (by + dy) * width + (bx + dx);
              srcSum += rgba[p * 4] + rgba[p * 4 + 1] + rgba[p * 4 + 2];
              const c = palette[indices[p]];
              outSum += c[0] + c[1] + c[2];
            }
          }
          totalErr += Math.abs(srcSum - outSum) / 16;
          blocks++;
        }
      }
      return totalErr / blocks;
    }

    const ditherError = blockLumaError(dithered);
    const flatError = blockLumaError(flat);
    assert.ok(
      ditherError < flatError,
      `Esperado erro médio menor com dithering (${ditherError.toFixed(2)}) vs sem dithering (${flatError.toFixed(2)})`
    );
  });
});

describe('Motor de Vídeo', () => {
  it('identifica arquivos de vídeo por MIME e fallback por extensão', () => {
    assert.equal(videoEngine.isVideoFile({ type: 'video/mp4', name: 'clip.mp4' }), true);
    assert.equal(videoEngine.isVideoFile({ type: 'video/webm', name: 'demo.webm' }), true);
    assert.equal(videoEngine.isVideoFile({ type: '', name: 'gravacao.MOV' }), true);
    assert.equal(videoEngine.isVideoFile({ type: 'application/octet-stream', name: 'a.m4v' }), true);
    assert.equal(videoEngine.isVideoFile({ type: 'image/png', name: 'print.png' }), false);
    assert.equal(videoEngine.isVideoFile({ type: 'audio/ogg', name: 'som.ogg' }), false);
  });

  it('calcula dimensões proporcionais sem fazer upscale', () => {
    assert.deepEqual(videoEngine.computeScaledVideoDimensions(1920, 1080, 0), {
      width: 1920,
      height: 1080,
    });
    assert.deepEqual(videoEngine.computeScaledVideoDimensions(1920, 1080, 960), {
      width: 960,
      height: 540,
    });
    assert.deepEqual(videoEngine.computeScaledVideoDimensions(640, 360, 1280), {
      width: 640,
      height: 360,
    });
  });

  it('sanitiza configuração de vídeo e respeita intervalo mínimo de recorte', () => {
    const cfg = videoEngine.sanitizeVideoConfig(
      { fps: 99, maxWidth: 720, trimStart: 9.95, trimEnd: 9.98 },
      10
    );
    assert.equal(cfg.fps, 30);
    assert.equal(cfg.maxWidth, 720);
    assert.ok(cfg.trimStart <= 9.9);
    assert.ok(cfg.trimEnd >= cfg.trimStart + 0.1);
  });

  it('calcula plano de exportação com timestamps válidos, aviso de frames e limite máximo', () => {
    const normal = videoEngine.computeVideoExportPlan(1920, 1080, 4, {
      fps: 15,
      maxWidth: 720,
      trimStart: 1,
      trimEnd: 3,
    });
    assert.equal(normal.width, 720);
    assert.equal(normal.height, 405);
    assert.equal(normal.frameCount, 30);
    assert.equal(normal.delayMs, 67);
    assert.equal(normal.isHighFrameCount, false);
    assert.equal(normal.wasCapped, false);
    assert.ok(normal.timestamps.every((t) => t >= 1 && t <= 4 - 0.005));

    const longClip = videoEngine.computeVideoExportPlan(1280, 720, 30, {
      fps: 30,
      maxWidth: 0,
      trimStart: 0,
      trimEnd: 30,
    });
    assert.equal(longClip.frameCount, 600);
    assert.equal(longClip.wasCapped, true);
    assert.equal(longClip.isHighFrameCount, true);
  });
});

describe('Gatekeeper de Estilo (mind-light-style & progress)', () => {
  it('não utiliza cores ou classes banidas nos arquivos do projeto', () => {
    const filesToCheck = [
      'src/pages/index.astro',
      'src/styles/global.css',
      'src/scripts/polisher-client.ts',
      'src/lib/types.ts',
      'src/lib/gif-engine.ts',
      'src/lib/webp-engine.ts',
      'src/lib/video-engine.ts',
      'src/lib/image-io.ts',
    ];
    const bannedPatterns = [/#0b0f19/i, /#0f172a/i, /#6366f1/i, /\bindigo-/, /\bteal-/];

    for (const rel of filesToCheck) {
      const content = fs.readFileSync(path.join(rootDir, rel), 'utf8');
      for (const pattern of bannedPatterns) {
        assert.equal(
          pattern.test(content),
          false,
          `Padrão banido ${pattern} encontrado em ${rel}`
        );
      }
    }
  });

  it('não agrupa pseudo-elementos -webkit- e -moz- na mesma regra CSS', () => {
    const css = fs.readFileSync(path.join(rootDir, 'src/styles/global.css'), 'utf8');
    const ruleHeaders = css.match(/[^{}]+\{/g) ?? [];
    for (const header of ruleHeaders) {
      const hasWebkit = header.includes('::-webkit-');
      const hasMoz = header.includes('::-moz-');
      assert.equal(
        hasWebkit && hasMoz,
        false,
        `Regra CSS agrupa pseudo-elementos de fornecedores distintos: ${header.trim()}`
      );
    }
  });
});
