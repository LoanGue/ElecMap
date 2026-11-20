/** Example circuits of the playground, with the analysis they open on. */

export type Tab = "dc" | "transfer" | "transient" | "impedance";

export interface Example {
  id: string;
  name: { en: string; fr: string };
  netlist: string;
  tab: Tab;
  /** Output node of the transfer function (and first traced signal). */
  output?: string;
  /** Traced voltages of the transient analysis. */
  trace?: string[];
  tStop?: number;
  /** Impedance probe. */
  port?: [string, string];
}

export const EXAMPLES: Example[] = [
  {
    id: "rc",
    name: { en: "RC low-pass filter", fr: "Filtre RC passe-bas" },
    netlist: `* RC low-pass filter
V1 in 0 PULSE(0 5 0 1u 1u 0.5m 1m) AC 1
R1 in out 1k
C1 out 0 100n
`,
    tab: "transfer",
    output: "out",
    trace: ["in", "out"],
    tStop: 2e-3,
  },
  {
    id: "rlc",
    name: { en: "Series RLC band-pass", fr: "RLC série passe-bande" },
    netlist: `* Series RLC band-pass: f0 = 1/(2π√(LC)) ≈ 5.03 kHz
V1 in 0 AC 1 SIN(0 1 5k)
L1 in a 10m
C1 a out 100n
R1 out 0 100
`,
    tab: "transfer",
    output: "out",
    trace: ["in", "out"],
    tStop: 2e-3,
  },
  {
    id: "sallen-key",
    name: { en: "Sallen-Key low-pass", fr: "Sallen-Key passe-bas" },
    netlist: `* Unity-gain Sallen-Key low-pass (ideal op-amp)
V1 in 0 AC 1 PULSE(0 1 0 1u 1u 1m 2m)
R1 in a 10k
R2 a b 10k
C1 a out 22n
C2 b 0 10n
X1 b out out OPAMP
`,
    tab: "transfer",
    output: "out",
    trace: ["in", "out"],
    tStop: 2e-3,
  },
  {
    id: "inverting",
    name: { en: "Inverting amplifier", fr: "Amplificateur inverseur" },
    netlist: `* Inverting amplifier, gain −Rf/Rin = −10
V1 in 0 DC 0.2 AC 1 SIN(0 0.2 1k)
Rin in m 1k
Rf m out 10k
X1 0 m out OPAMP
`,
    tab: "dc",
    output: "out",
    trace: ["in", "out"],
    tStop: 3e-3,
  },
  {
    id: "rectifier",
    name: { en: "Half-wave rectifier", fr: "Redresseur simple alternance" },
    netlist: `* Half-wave rectifier with a smoothing capacitor
V1 in 0 SIN(0 10 50)
D1 in out D1N4148
C1 out 0 100u
R1 out 0 1k
.model D1N4148 D(IS=2.52n N=1.752 RS=0.568 CJO=4p)
`,
    tab: "transient",
    trace: ["in", "out"],
    tStop: 60e-3,
  },
  {
    id: "common-emitter",
    name: { en: "Common-emitter amplifier", fr: "Amplificateur émetteur commun" },
    netlist: `* Common-emitter stage with a 2N2222
VCC vcc 0 12
VS in 0 AC 1
CIN in b 10u
RB1 vcc b 47k
RB2 b 0 10k
RC vcc c 2.2k
RE e 0 470
CE e 0 100u
Q1 c b e Q2N2222
.model Q2N2222 NPN(IS=14.34f BF=255.9 VAF=74.03 CJE=22p CJC=7.3p)
`,
    tab: "transfer",
    output: "c",
  },
  {
    id: "wheatstone",
    name: { en: "Wheatstone bridge", fr: "Pont de Wheatstone" },
    netlist: `* Wheatstone bridge, slightly unbalanced
V1 top 0 10
R1 top a 1k
R2 a 0 1k
R3 top b 1k
R4 b 0 1.1k
R5 a b 10k
`,
    tab: "dc",
    port: ["a", "b"],
  },
  {
    id: "lc-ladder",
    name: { en: "LC ladder (impedance)", fr: "Échelle LC (impédance)" },
    netlist: `* Third-order LC ladder terminated by 50 Ω
I1 0 in AC 1
L1 in a 1u
C1 a 0 1n
L2 a out 1u
R1 out 0 50
`,
    tab: "impedance",
    port: ["in", "0"],
  },
];
