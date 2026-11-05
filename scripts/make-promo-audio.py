import array
import math
import random
import wave
from pathlib import Path

RATE = 44100
DURATION = 27.0
N = int(RATE * DURATION)
mix = array.array('f', [0.0]) * (N * 2)
random.seed(4741)
TAU = math.tau


def add_tone(start, length, freq, amp, pan=0.0, waveform='sine', attack=0.015, release=0.12):
    first = max(0, int(start * RATE))
    last = min(N, int((start + length) * RATE))
    if last <= first:
        return
    left = math.sqrt((1 - pan) * 0.5)
    right = math.sqrt((1 + pan) * 0.5)
    for i in range(first, last):
        t = (i - first) / RATE
        remaining = (last - i) / RATE
        env = min(1.0, t / max(attack, 0.0001), remaining / max(release, 0.0001))
        env = env * env * (3 - 2 * env)
        phase = TAU * freq * t
        if waveform == 'triangle':
            value = 2 / math.pi * math.asin(math.sin(phase))
        elif waveform == 'square':
            value = 1 if math.sin(phase) >= 0 else -1
        else:
            value = math.sin(phase)
        sample = value * amp * env
        mix[i * 2] += sample * left
        mix[i * 2 + 1] += sample * right


def add_kick(start, amp=0.28):
    first = int(start * RATE)
    last = min(N, first + int(0.28 * RATE))
    for i in range(max(0, first), last):
        t = (i - first) / RATE
        env = math.exp(-t * 18)
        freq = 105 * math.exp(-t * 15) + 42
        sample = math.sin(TAU * freq * t) * amp * env
        mix[i * 2] += sample
        mix[i * 2 + 1] += sample


def add_hat(start, amp=0.045, pan=0.0):
    first = int(start * RATE)
    last = min(N, first + int(0.075 * RATE))
    left = math.sqrt((1 - pan) * 0.5)
    right = math.sqrt((1 + pan) * 0.5)
    previous = 0.0
    for i in range(max(0, first), last):
        t = (i - first) / RATE
        noise = random.uniform(-1, 1)
        # A simple high-passed noise tick, softened by a short envelope.
        value = (noise - previous) * 0.5
        previous = noise
        sample = value * amp * math.exp(-t * 65)
        mix[i * 2] += sample * left
        mix[i * 2 + 1] += sample * right


def add_impact(start, amp=0.22):
    add_tone(start, 0.65, 55, amp, waveform='sine', attack=0.005, release=0.45)
    add_tone(start, 0.32, 220, amp * 0.32, pan=-0.15, waveform='triangle', attack=0.005, release=0.24)
    add_tone(start + 0.02, 0.42, 440, amp * 0.18, pan=0.2, waveform='sine', attack=0.005, release=0.32)


# D-minor synthwave bed. All sounds are synthesized locally for this promo.
beat = 60 / 112
intro_end = 2.8
# Long, quiet pad chords under the title and the outro.
for start, chord in [(0.0, [146.83, 174.61, 220.0]), (7.0, [130.81, 164.81, 196.0]), (14.0, [146.83, 174.61, 220.0]), (21.0, [130.81, 164.81, 196.0])]:
    for index, freq in enumerate(chord):
        add_tone(start, 7.2, freq, 0.027, pan=(index - 1) * 0.35, waveform='triangle', attack=0.65, release=1.0)

# Bass and an eighth-note arpeggio, held back during the title card.
notes = [293.66, 349.23, 440.0, 523.25, 440.0, 349.23, 261.63, 349.23]
for step in range(int(DURATION / (beat / 2)) + 1):
    start = step * beat / 2
    if start < intro_end:
        continue
    intensity = 0.75 if start < 14.8 else 1.0 if start < 20.0 else 0.58
    add_tone(start, beat * 0.43, notes[step % len(notes)], 0.055 * intensity, pan=math.sin(step * 0.8) * 0.35, waveform='triangle', attack=0.008, release=0.09)
    if step % 2 == 0:
        add_tone(start, beat * 0.8, notes[(step // 2) % 4] / 2, 0.105 * intensity, waveform='sine', attack=0.008, release=0.18)

for step in range(int(DURATION / beat) + 1):
    start = step * beat
    if start >= intro_end and start < 23.5:
        add_kick(start, 0.22 if start < 14.8 else 0.28)
        add_hat(start + beat * 0.5, 0.035 if start < 14.8 else 0.05, pan=0.25)
        if step % 2 == 1:
            add_hat(start, 0.025, pan=-0.3)

for timestamp in [0.0, 2.8, 8.3, 11.8, 15.0, 20.0, 23.5]:
    add_impact(timestamp, 0.16 if timestamp not in (2.8, 15.0, 23.5) else 0.24)

# A soft upward sweep into the final call to action.
for step in range(12):
    start = 22.7 + step * 0.055
    add_tone(start, 0.18, 330 + step * 32, 0.035, pan=(step % 3 - 1) * 0.3, waveform='sine', attack=0.01, release=0.15)

pcm = array.array('h')
for i in range(N):
    # Gentle master saturation and clean fades at both ends.
    fade = min(1.0, i / (RATE * 0.35), (N - i) / (RATE * 0.8))
    for channel in range(2):
        value = math.tanh(mix[i * 2 + channel] * 1.15) * 0.72 * fade
        pcm.append(int(max(-1, min(1, value)) * 32767))

output = Path('/tmp/echo-promo/soundtrack.wav')
output.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(output), 'wb') as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(RATE)
    wav.writeframes(pcm.tobytes())
print(output)
