import { assert, describe, expect, it } from "vitest";
import { state$ } from "../src/main";

describe("state$", () => {
    it("is defined", () => {
        assert.isDefined(state$);
    });
    it("is a function", () => {
        assert.isFunction(state$);
    });
});
