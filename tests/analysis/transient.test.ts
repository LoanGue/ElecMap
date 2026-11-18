import { describe, expect, it } from "vitest";
import { ElecMap, expm, waveformValue } from "../../src";

const ctx = { tStep: 1e-6, tStop: 1e-3 };

describe("waveforms", () => {
  it("evaluates SPICE waveforms", () => {
    const sine = { kind: "sine", offset: 1, amplitude: 2, freq: 50 } as const;
    expect(waveformValue(sine, 0.005, ctx)).toBeCloseTo(3, 12);
    const pulse = {
      kind: "pulse",
      v1: 0,
      v2: 5,
      delay: 1e-4,
      rise: 1e-5,
      fall: 1e-5,
      width: 1e-4,
      period: 4e-4,
    } as const;
    expect(waveformValue(pulse, 0, ctx)).toBe(0);
    expect(waveformValue(pulse, 1.05e-4, ctx)).toBeCloseTo(2.5, 12);
    expect(waveformValue(pulse, 1.5e-4, ctx)).toBe(5);
    expect(waveformValue(pulse, 1.5e-4 + 4e-4, ctx)).toBeCloseTo(5, 9);
    expect(waveformValue(pulse, 3e-4, ctx)).toBe(0);
    const pwl = {
      kind: "pwl",
      points: [
        [0, 0],
        [1, 2],
        [2, 2],
      ],
    } as const;
    expect(
      waveformValue(
        { kind: "pwl", points: pwl.points.map((p) => [...p] as [number, number]) },
        0.5,
        ctx,
      ),
    ).toBe(1);
    expect(waveformValue({ kind: "step", v2: 3, delay: 1 }, 0.5, ctx)).toBe(0);
    expect(waveformValue({ kind: "step", v2: 3, delay: 1 }, 1, ctx)).toBe(0);
    expect(waveformValue({ kind: "step", v2: 3, delay: 1 }, 1.001, ctx)).toBe(3);
    const exp = { kind: "exp", v1: 0, v2: 1, td1: 0, tau1: 1e-3, td2: 1, tau2: 1e-3 } as const;
    expect(waveformValue(exp, 1e-3, ctx)).toBeCloseTo(1 - Math.exp(-1), 12);
  });
});

describe("matrix exponential", () => {
  it("matches closed forms", () => {
    const e = expm([
      [0, 1],
      [-1, 0],
    ]); // rotation by 1 rad
    expect(e[0]?.[0]).toBeCloseTo(Math.cos(1), 13);
    expect(e[0]?.[1]).toBeCloseTo(Math.sin(1), 13);
    const big = expm([
      [-50, 0],
      [0, 3],
    ]);
    expect((big[0]?.[0] as number) / Math.exp(-50)).toBeCloseTo(1, 9);
    expect((big[1]?.[1] as number) / Math.exp(3)).toBeCloseTo(1, 12);
  });
});

describe("transfer function time responses", () => {
  const rc = new ElecMap("V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u");
  const H = rc.transferFunction({ input: "V1", output: "out" });

  it("gives the exact RC step response", () => {
    const r = H.stepResponse({ tStop: 5e-3, points: 50 });
    r.time.forEach((t, k) => expect(r.value[k]).toBeCloseTo(1 - Math.exp(-t / 1e-3), 12));
    const info = H.stepInfo();
    expect(info.finalValue).toBeCloseTo(1, 12);
    expect(info.overshoot).toBe(0);
    expect(info.riseTime).toBeCloseTo(1e-3 * Math.log(9), 5);
  });

  it("gives the impulse response and feed-through", () => {
    const r = H.impulseResponse({ tStop: 3e-3, points: 30 });
    r.time.forEach((t, k) =>
      expect((r.value[k] as number) * 1e-3).toBeCloseTo(Math.exp(-t / 1e-3), 10),
    );
    expect(r.impulse).toBeUndefined();
    const hp = new ElecMap("V1 in 0 AC 1\nC1 in out 1u\nR1 out 0 1k").transferFunction({
      input: "V1",
      output: "out",
    });
    expect(hp.impulseResponse({ tStop: 1e-3 }).impulse).toBeCloseTo(1, 12);
    expect(hp.stepResponse({ tStop: 1e-3, points: 1 }).value[1]).toBeCloseTo(Math.exp(-1), 12);
  });

  it("characterises an underdamped RLC step", () => {
    // ω0 = 1e4 rad/s, Q = 2 → ζ = 0.25, overshoot = exp(−πζ/√(1−ζ²)) ≈ 44.4 %.
    const rlc = new ElecMap("V1 in 0 AC 1\nR1 in a 50\nL1 a out 10m\nC1 out 0 1u").transferFunction(
      { input: "V1", output: "out" },
    );
    const info = rlc.stepInfo({ points: 4000 });
    const zeta = 0.25;
    expect(info.overshoot).toBeCloseTo(
      100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)),
      1,
    );
    expect(info.peakTime).toBeCloseTo(Math.PI / (1e4 * Math.sqrt(1 - zeta * zeta)), 6);
    expect(info.settlingTime).toBeDefined();
  });

  it("filters arbitrary inputs", () => {
    const f = 1 / (2 * Math.PI * 1e-3);
    const r = H.response((t) => Math.sin(2 * Math.PI * f * t), { tStop: 20e-3, points: 20000 });
    const ss = H.apply({ amplitude: 1, freq: f });
    const tail = r.time.map((t, k) =>
      t > 15e-3 ? Math.abs((r.value[k] as number) - ss.at(t)) : 0,
    );
    expect(Math.max(...tail)).toBeLessThan(2e-3); // ZOH error ~ ω·h/2
    expect(() =>
      new ElecMap("V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u")
        .transferFunction({ input: "V1", output: { current: "C1" } })
        .stepResponse(),
    ).not.toThrow();
  });
});

describe("transient analysis", () => {
  it("charges an RC from a step (all methods)", () => {
    const c = new ElecMap("V1 in 0 0\nR1 in out 1k\nC1 out 0 1u");
    for (const method of ["gear2", "trap", "euler"] as const) {
      const tr = c.transient({
        tStop: 5e-3,
        tStep: 1e-6,
        method,
        inputs: { V1: { kind: "step", v2: 1 } },
      });
      const v = tr.voltage("out");
      const k = tr.time.findIndex((t) => t >= 1e-3 - 1e-12);
      const tol = method === "euler" ? 1e-3 : 1e-5;
      expect(Math.abs((v[k] as number) - (1 - Math.exp(-1)))).toBeLessThan(tol);
      const i = tr.current("C1");
      expect(Math.abs((i[k] as number) - Math.exp(-1) / 1000)).toBeLessThan(tol * 1e-3 * 5);
    }
  });

  it("uses initial conditions and conserves energy in an LC tank", () => {
    const c = new ElecMap("C1 a 0 1u IC=1\nL1 a 0 1m");
    const f0 = 1 / (2 * Math.PI * Math.sqrt(1e-3 * 1e-6));
    const tr = c.transient({ tStop: 5 / f0, tStep: 1 / f0 / 2000, method: "trap" });
    const v = tr.voltage("a");
    expect(v[0]).toBeCloseTo(1, 6);
    tr.time.forEach((t, k) =>
      expect(Math.abs((v[k] as number) - Math.cos(2 * Math.PI * f0 * t))).toBeLessThan(1e-4),
    );
    const iL = tr.current("L1");
    const energy = v.map((vk, k) => 0.5 * 1e-6 * vk * vk + 0.5 * 1e-3 * (iL[k] as number) ** 2);
    expect(Math.max(...energy) - Math.min(...energy)).toBeLessThan(1e-9);
  });

  it("starts from the operating point and follows a source override", () => {
    const c = new ElecMap("V1 in 0 DC 2\nR1 in out 1k\nC1 out 0 1u\nR2 out 0 1k");
    const tr = c.transient({ tStop: 1e-3 });
    tr.voltage("out").forEach((v) => expect(v).toBeCloseTo(1, 9));
    const p = tr.power("R1");
    expect(p[0]).toBeCloseTo(1e-3, 9);
    const sine = c.transient({
      tStop: 2e-2,
      tStep: 1e-5,
      tStart: 1e-2,
      inputs: { V1: (t) => Math.sin(2 * Math.PI * 100 * t) },
    });
    expect(sine.time[0]).toBeCloseTo(1e-2, 12);
    expect(() => c.transient({ tStop: -1 })).toThrow();
    expect(() => c.transient({ tStop: 1, inputs: { R1: 1 } })).toThrow();
  });

  it("matches the transfer function step response", () => {
    const netlist = "V1 in 0 0\nR1 in a 50\nL1 a out 10m\nC1 out 0 1u";
    const c = new ElecMap(netlist);
    const tr = c.transient({ tStop: 3e-3, tStep: 2e-7, inputs: { V1: { kind: "step", v2: 1 } } });
    const ref = new ElecMap(netlist.replace("V1 in 0 0", "V1 in 0 AC 1"))
      .transferFunction({ input: "V1", output: "out" })
      .stepResponse({ tStop: 3e-3, tStep: 2e-7 });
    const v = tr.voltage("out");
    const err = Math.max(...v.map((vk, k) => Math.abs(vk - (ref.value[k] as number))));
    expect(err).toBeLessThan(1e-4);
  });
});
