import assert from "node:assert/strict";
import test from "node:test";
import { parseElectronProxy } from "../src/main/network/http-dispatcher.ts";

test("parseElectronProxy parses fixed HTTP and HTTPS proxy rules", () => {
	assert.equal(parseElectronProxy("PROXY 127.0.0.1:7890; DIRECT"), "http://127.0.0.1:7890");
	assert.equal(parseElectronProxy("HTTPS proxy.example.test:8443; DIRECT"), "https://proxy.example.test:8443");
});

test("parseElectronProxy ignores direct and unsupported rules", () => {
	assert.equal(parseElectronProxy("DIRECT"), undefined);
	assert.equal(parseElectronProxy("SOCKS5 127.0.0.1:1080; DIRECT"), undefined);
});
