import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ffmpeg = process.env.FFMPEG_PATH ?? '/tmp/ffmpeg-pkg/package/ffmpeg';
const root = '/tmp/echo-promo';
const assets = path.join(root, 'assets');
const raw = path.join(root, 'raw');
const segments = path.join(root, 'segments');
const outputDir = path.resolve('promo');
fs.mkdirSync(segments, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

function run(args) {
  execFileSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

function scene(name, start, duration) {
  const output = path.join(segments, `${name}.mp4`);
  const fadeOut = Math.max(0, duration - 0.18).toFixed(2);
  run([
    '-y', '-loglevel', 'error',
    '-loop', '1', '-framerate', '30', '-i', path.join(assets, 'background.png'),
    '-ss', String(start), '-i', path.join(raw, `${name}.webm`),
    '-loop', '1', '-framerate', '30', '-i', path.join(assets, `overlay-${name}.png`),
    '-filter_complex',
    `[1:v]trim=duration=${duration},setpts=PTS-STARTPTS,scale=1008:567:flags=lanczos,eq=brightness=0.035:contrast=1.1:saturation=1.2,fps=30[clip];` +
    `[0:v]trim=duration=${duration},setpts=PTS-STARTPTS[bg];` +
    `[bg][clip]overlay=36:330:shortest=1[base];` +
    `[base][2:v]overlay=0:0:format=auto,fade=t=in:st=0:d=0.18,fade=t=out:st=${fadeOut}:d=0.18,format=yuv420p[out]`,
    '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-r', '30',
    '-t', String(duration), '-video_track_timescale', '90000', '-movflags', '+faststart', output,
  ]);
  return output;
}

function card(name, duration, final = false) {
  const output = path.join(segments, `${name}.mp4`);
  const fadeOut = Math.max(0, duration - 0.35).toFixed(2);
  run([
    '-y', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-i', path.join(assets, `${name}.png`),
    '-vf', `fade=t=in:st=0:d=0.35,fade=t=out:st=${fadeOut}:d=0.35,format=yuv420p`,
    '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-r', '30', '-t', String(duration),
    '-video_track_timescale', '90000', '-movflags', '+faststart', output,
  ]);
  return output;
}

const files = [
  card('intro', 2.8),
  scene('combat', 5.5, 5.5),
  scene('rail', 2.0, 3.5),
  scene('draft', 2.0, 3.2),
  scene('boss', 6.0, 5.0),
  scene('menu', 2.0, 3.5),
  card('outro', 3.5, true),
];
const list = path.join(root, 'concat.txt');
fs.writeFileSync(list, files.map(file => `file '${file}'`).join('\n') + '\n');
const joined = path.join(root, 'joined.mp4');
run(['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
  '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
  '-video_track_timescale', '90000', '-movflags', '+faststart', joined]);

const final = path.join(outputDir, 'echo-abyss-short.mp4');
run(['-y', '-loglevel', 'error', '-i', joined, '-i', path.join(root, 'soundtrack.wav'),
  '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', 'volume=1.25',
  '-t', '27', '-movflags', '+faststart', '-metadata', 'title=ECHO//ABYSS — Short Promo',
  '-metadata', 'comment=Original gameplay capture and synthesized soundtrack', final]);
run(['-y', '-loglevel', 'error', '-ss', '1.1', '-i', final, '-frames:v', '1', '-q:v', '2', path.join(outputDir, 'echo-abyss-short.jpg')]);
console.log(final);
