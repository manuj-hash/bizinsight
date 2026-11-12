const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidDateOnly, validateCompensationInput } = require("../utils/compensationValidation");

test("accepts valid calendar dates including leap days", () => {
    assert.equal(isValidDateOnly("2028-02-29"), true);
    assert.equal(isValidDateOnly("2027-02-29"), false);
    assert.equal(isValidDateOnly("2026-13-01"), false);
    assert.equal(isValidDateOnly("2026-2-01"), false);
});

test("accepts valid compensation input and defaults", () => {
    assert.deepEqual(
        validateCompensationInput({ base_salary: "45000.50" }, "2026-11-12"),
        {
            valid: true,
            salary: 45000.5,
            currencyCode: "INR",
            payFrequency: "monthly",
            effectiveFrom: "2026-11-12"
        }
    );
});

test("rejects negative, malformed and over-precision salaries", () => {
    for (const base_salary of ["-1", "1.234", "abc", "", "1000000000000"]) {
        assert.equal(validateCompensationInput({ base_salary }, "2026-11-12").valid, false);
    }
});

test("rejects invalid currency, frequency and past or impossible dates", () => {
    assert.equal(validateCompensationInput({ base_salary: 10, currency_code: "US" }, "2026-11-12").valid, false);
    assert.equal(validateCompensationInput({ base_salary: 10, pay_frequency: "daily" }, "2026-11-12").valid, false);
    assert.equal(validateCompensationInput({ base_salary: 10, effective_from: "2026-11-11" }, "2026-11-12").valid, false);
    assert.equal(validateCompensationInput({ base_salary: 10, effective_from: "2026-02-30" }, "2026-11-12").valid, false);
});
