<div class="em-hero">
<h1>ElecMap</h1>
<p class="em-tagline">Describe a circuit in a few lines of SPICE. Get its transfer function, voltages, currents, impedances, time response and schematic, all from one TypeScript class.</p>
<div class="em-buttons"><a class="em-button" href="./getting-started.md">Get started →</a><span class="em-button em-ghost">{@link ElecMap | API reference}</span><a class="em-button em-ghost" href="https://loangue.github.io/ElecMap/playground/">Try it online</a><a class="em-button em-ghost" href="https://github.com/LoanGue/ElecMap">GitHub</a></div>
</div>

## In 30 seconds

```ts
import { ElecMap } from "elecmap";

const filter = new ElecMap(`
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`);

const H = filter.transferFunction("out");
H.toLatex(); // "\frac{1}{1 + 10^{-4}\,s}"
H.filterType(); // "lowpass"
H.cutoffFrequency(); // 1591.55 (Hz)

filter.symbolicTransferFunction("out").toLatex(); // "\frac{1}{1 + R_{1} C_{1} s}"
filter.toSVG(); // the drawing below
```

<div class="em-row">
<figure class="em-figure">
{@include ./figures/rc-lowpass.svg}
<figcaption><code>filter.toSVG({ showValues: true })</code></figcaption>
</figure>
<figure class="em-figure">
<div class="em-math">H(s) = \frac{1}{1 + R_{1} C_{1} s} = \frac{1}{1 + 10^{-4}\,s}</div>
<figcaption>Literal and numeric transfer functions, generated as LaTeX</figcaption>
</figure>
</div>

## Guides

Every guide is a series of short, runnable examples with their real output.

<div class="em-cards">
<a class="em-card" href="./getting-started.md"><span class="em-icon">🚀</span><strong>Getting started</strong><span>Install, describe a first circuit, read results.</span></a>
<a class="em-card" href="./voltages-currents-power.md"><span class="em-icon">🔋</span><strong>Voltages, currents & power</strong><span>DC operating point, AC phasors, sweeps, power balance.</span></a>
<a class="em-card" href="./transfer-functions.md"><span class="em-icon">📈</span><strong>Transfer functions</strong><span>H(s) in LaTeX, Bode plots, poles, cutoff, Q, sine response.</span></a>
<a class="em-card" href="./literal-transfer-functions.md"><span class="em-icon">∑</span><strong>Literal transfer functions</strong><span>H(s) written with R₁, C₂… and re-evaluated with new values.</span></a>
<a class="em-card" href="./impedances-equivalents.md"><span class="em-icon">Ω</span><strong>Impedances & equivalents</strong><span>Equivalent R, L, C, Z(s), Thévenin and Norton.</span></a>
<a class="em-card" href="./time-domain.md"><span class="em-icon">⏱</span><strong>Time domain</strong><span>Step and impulse responses, transient simulation.</span></a>
<a class="em-card" href="./diodes.md"><span class="em-icon">▷|</span><strong>Diodes</strong><span>Non-linear circuits: rectifiers, Zener regulators, small signal.</span></a>
<a class="em-card" href="./transistors.md"><span class="em-icon">⏚</span><strong>Transistors</strong><span>BJT and MOSFET: bias points, amplifiers, CMOS logic.</span></a>
<a class="em-card" href="./sensitivities.md"><span class="em-icon">∂</span><strong>Sensitivities</strong><span>Which component matters: derivatives, ranking, bias stability.</span></a>
<a class="em-card" href="./schematics.md"><span class="em-icon">✏️</span><strong>Schematics</strong><span>Automatic SVG drawings, IEC or ANSI, interactive.</span></a>
<a class="em-card" href="./format.md"><span class="em-icon">📄</span><strong>Netlists & JSON</strong><span>Input syntax, JSON format, validation errors.</span></a>
<a class="em-card" href="https://loangue.github.io/ElecMap/playground/"><span class="em-icon">▶</span><strong>Playground</strong><span>Write a netlist or draw the circuit with blocks in the browser: schematic, Bode plot, transient, impedance.</span></a>
</div>

## What's inside

| You want…                            | Call                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| a voltage or a current               | {@link ElecMap.voltage}, {@link ElecMap.current}                                                        |
| H(s), in numbers or in symbols       | {@link ElecMap.transferFunction}, {@link ElecMap.symbolicTransferFunction}                              |
| a Bode plot, poles, cutoff frequency | {@link TransferFunction.bode}, {@link TransferFunction.poles}, {@link TransferFunction.cutoffFrequency} |
| an equivalent R, L, C or Z           | {@link ElecMap.equivalentResistance}, {@link ElecMap.impedance}                                         |
| Thévenin / Norton                    | {@link ElecMap.thevenin}, {@link ElecMap.norton}                                                        |
| the response over time               | {@link TransferFunction.stepResponse}, {@link ElecMap.transient}                                        |
| a drawing                            | {@link ElecMap.toSVG}                                                                                   |

ElecMap has **no runtime dependencies**, ships ESM + CommonJS with full types, and runs in Node.js ≥ 18 and in browsers. Components: R, L, C, coupled inductors, V and I sources, controlled sources (E, F, G, H), op-amps (ideal, finite gain, GBW), switches, diodes / Zener diodes, bipolar transistors and MOSFETs with SPICE `.model` cards.
