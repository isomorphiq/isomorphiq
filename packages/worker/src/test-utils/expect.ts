// Simple test assertion utilities
export function expect(actual: any) {
    return {
        toBe(expected: any) {
            if (actual !== expected) {
                throw new Error(`Expected ${expected}, but got ${actual}`);
            }
        },
        toEqual(expected: any) {
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                throw new Error(`Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`);
            }
        },
        toContain(expected: any) {
            if (!Array.isArray(actual) && typeof actual !== 'string') {
                throw new Error(`Expected ${actual} to be an array or string`);
            }
            if (!actual.includes(expected)) {
                throw new Error(`Expected ${actual} to contain ${expected}`);
            }
        },
        toHaveLength(expected: number) {
            if (!Array.isArray(actual) && typeof actual !== 'string') {
                throw new Error(`Expected ${actual} to be an array or string`);
            }
            if (actual.length !== expected) {
                throw new Error(`Expected length ${expected}, but got ${actual.length}`);
            }
        },
        toHaveProperty(property: string, value?: any) {
            if (typeof actual !== 'object' || actual === null || !(property in actual)) {
                throw new Error(`Expected ${actual} to have property ${property}`);
            }
            if (value !== undefined && actual[property] !== value) {
                throw new Error(`Expected ${actual}[${property}] to be ${value}, but got ${actual[property]}`);
            }
        },
        toBeDefined() {
            if (actual === undefined) {
                throw new Error(`Expected ${actual} to be defined`);
            }
        },
        toBeNull() {
            if (actual !== null) {
                throw new Error(`Expected ${actual} to be null`);
            }
        },
        toBeInstanceOf(expectedClass: any) {
            if (!(actual instanceof expectedClass)) {
                throw new Error(`Expected ${actual} to be instance of ${expectedClass}`);
            }
        },
        toBeGreaterThan(expected: any) {
            if (actual <= expected) {
                throw new Error(`Expected ${actual} to be greater than ${expected}`);
            }
        },
        toBeLessThan(expected: any) {
            if (actual >= expected) {
                throw new Error(`Expected ${actual} to be less than ${expected}`);
            }
        },
        toBeTruthy() {
            if (!actual) {
                throw new Error(`Expected ${actual} to be truthy`);
            }
        },
        toBeFalsy() {
            if (actual) {
                throw new Error(`Expected ${actual} to be falsy`);
            }
        },
        toThrow() {
            let threw = false;
            try {
                if (typeof actual === 'function') {
                    actual();
                }
            } catch (error) {
                threw = true;
            }
            if (!threw) {
                throw new Error(`Expected function to throw`);
            }
        },
        get not() {
            return {
                toBe(expected: any) {
                    if (actual === expected) {
                        throw new Error(`Expected ${actual} NOT to be ${expected}`);
                    }
                },
                toContain(expected: any) {
                    if (Array.isArray(actual) || typeof actual === 'string') {
                        if (actual.includes(expected)) {
                            throw new Error(`Expected ${actual} NOT to contain ${expected}`);
                        }
                    }
                },
                toHaveProperty(property: string) {
                    if (typeof actual === 'object' && actual !== null && property in actual) {
                        throw new Error(`Expected ${actual} NOT to have property ${property}`);
                    }
                },
                toThrow() {
                    let threw = false;
                    try {
                        if (typeof actual === 'function') {
                            actual();
                        }
                    } catch (error) {
                        threw = true;
                    }
                    if (threw) {
                        throw new Error(`Expected function NOT to throw`);
                    }
                }
            };
        }
    };
}