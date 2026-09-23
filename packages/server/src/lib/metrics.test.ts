import { afterEach, describe, expect, it } from "vitest";
import { bootTestAppWith } from "../test/setup.js";
import {
  countMetric,
  gaugeMetric,
  renderMetrics,
  resetMetrics,
} from "./metrics.js";

describe("metrics", () => {
  afterEach(() => resetMetrics());

  it("renders counters with labels and gauges read at scrape time", async () => {
    countMetric("demo_total", "A demo.", { kind: 'a"b' });
    countMetric("demo_total", "A demo.", { kind: 'a"b' }, 2);
    let n = 1;
    gaugeMetric("demo_gauge", "Read late.", () => n);
    n = 5;
    const text = await renderMetrics("1.2.3");
    expect(text).toContain('manifesto_build_info{version="1.2.3"} 1');
    expect(text).toContain("# TYPE demo_total counter");
    expect(text).toContain('demo_total{kind="a\\"b"} 3');
    expect(text).toContain("demo_gauge 5");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("is off without METRICS_TOKEN, and asks for it when on", async () => {
    const off = await bootTestAppWith({});
    expect((await off.request("/metrics")).status).toBe(404);
    await off.close();

    const on = await bootTestAppWith({ metricsToken: "scrape-me" });
    await on.request("/api/health");
    expect((await on.request("/metrics")).status).toBe(404);
    expect(
      (
        await on.request("/metrics", {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
    ).toBe(404);
    const res = await on.request("/metrics", {
      headers: { Authorization: "Bearer scrape-me" },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(
      'manifesto_http_requests_total{method="GET",status="2xx"}',
    );
    await on.close();
  });
});
