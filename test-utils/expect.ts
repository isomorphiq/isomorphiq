import assert from "node:assert/strict";

type Matcher = {
    toBe: (expected: unknown) => void;
    toEqual: (expected: unknown) => void;
    toContain: (expected: unknown) => void;
    toHaveProperty: (prop: string, expected?: unknown) => void;
    toHaveLength: (expected: number) => void;
    toBeDefined: () => void;
    toBeTruthy: () => void;
    toBeNull: () => void;
    toMatch: (expected: RegExp | string) => void;
    toBeGreaterThan: (expected: number) => void;
    toBeGreaterThanOrEqual: (expected: number) => void;
    toBeLessThan: (expected: number) => void;
    toBeLessThanOrEqual: (expected: number) => void;
    toBeInstanceOf: (expected: new (...args: unknown[]) => unknown) => void;
    toThrow: (expected?: string | RegExp) => void;
};

type Expectation = Matcher & { not: Matcher };

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

const isDeepEqual = (left: unknown, right: unknown): boolean => {
    try {
        assert.deepStrictEqual(left, right);
        return true;
    } catch {
        return false;
    }
};

const createMatchers = (value: unknown, negated: boolean): Matcher => {
    const assertCondition = (condition: boolean, message: string): void => {
        if (negated) {
            assert.ok(!condition, message);
        } else {
            assert.ok(condition, message);
        }
    };

    return {
        toBe: (expected: unknown) => {
            if (negated) {
                assert.notStrictEqual(value, expected);
            } else {
                assert.strictEqual(value, expected);
            }
        },
        toEqual: (expected: unknown) => {
            if (negated) {
                assert.notDeepStrictEqual(value, expected);
            } else {
                assert.deepStrictEqual(value, expected);
            }
        },
        toContain: (expected: unknown) => {
            const contains = Array.isArray(value)
                ? value.includes(expected)
                : typeof value === "string"
                    ? value.includes(String(expected))
                    : false;
            assertCondition(contains, "Expected value to contain the provided item");
        },
        toHaveProperty: (prop: string, expected?: unknown) => {
            if (!isObject(value)) {
                assertCondition(false, "Expected an object to check properties on");
                return;
            }
            const hasProp = Object.hasOwn(value, prop);
            if (expected === undefined) {
                assertCondition(hasProp, `Expected object to have property "${prop}"`);
                return;
            }
            const actual = hasProp ? Object.getOwnPropertyDescriptor(value, prop)?.value : undefined;
            const matches = hasProp && isDeepEqual(actual, expected);
            assertCondition(matches, `Expected object property "${prop}" to match`);
        },
        toHaveLength: (expected: number) => {
            if (typeof value !== "string" && !Array.isArray(value)) {
                assertCondition(false, "Expected a string or array with length");
                return;
            }
            const matches = value.length === expected;
            assertCondition(matches, `Expected length to be ${expected}`);
        },
        toBeDefined: () => {
            assertCondition(value !== undefined, "Expected value to be defined");
        },
        toBeTruthy: () => {
            assertCondition(Boolean(value), "Expected value to be truthy");
        },
        toBeNull: () => {
            assertCondition(value === null, "Expected value to be null");
        },
        toMatch: (expected: RegExp | string) => {
            const stringValue = String(value);
            const matches = expected instanceof RegExp
                ? expected.test(stringValue)
                : stringValue.includes(expected);
            assertCondition(matches, "Expected value to match");
        },
        toBeGreaterThan: (expected: number) => {
            const matches = typeof value === "number" && value > expected;
            assertCondition(matches, `Expected value to be greater than ${expected}`);
        },
        toBeGreaterThanOrEqual: (expected: number) => {
            const matches = typeof value === "number" && value >= expected;
            assertCondition(matches, `Expected value to be greater than or equal to ${expected}`);
        },
        toBeLessThan: (expected: number) => {
            const matches = typeof value === "number" && value < expected;
            assertCondition(matches, `Expected value to be less than ${expected}`);
        },
        toBeLessThanOrEqual: (expected: number) => {
            const matches = typeof value === "number" && value <= expected;
            assertCondition(matches, `Expected value to be less than or equal to ${expected}`);
        },
        toBeInstanceOf: (expected: new (...args: unknown[]) => unknown) => {
            const matches = value instanceof expected;
            assertCondition(matches, "Expected value to be instance of constructor");
        },
        toThrow: (expected?: string | RegExp) => {
            if (typeof value !== "function") {
                assertCondition(false, "Expected a function to test for throws");
                return;
            }
            let threw = false;
            let message = "";
            try {
                value();
            } catch (error) {
                threw = true;
                message = error instanceof Error ? error.message : String(error);
            }
            if (expected === undefined) {
                assertCondition(threw, "Expected function to throw");
                return;
            }
            const matches = threw
                && (typeof expected === "string" ? message.includes(expected) : expected.test(message));
            assertCondition(matches, "Expected function to throw matching error");
        },
    };
};

export const expect = (value: unknown): Expectation => {
    const positive = createMatchers(value, false);
    const negative = createMatchers(value, true);
    return {
        ...positive,
        not: negative,
    };
};
