const isValidDateOnly = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const validateCompensationInput = (body = {}, today = new Date().toISOString().slice(0, 10)) => {
    const rawSalary = body.base_salary;
    const salaryText = typeof rawSalary === "number" ? String(rawSalary) : String(rawSalary ?? "").trim();
    const salary = Number(salaryText);
    const currencyCode = String(body.currency_code || "INR").trim().toUpperCase();
    const payFrequency = body.pay_frequency || "monthly";
    const effectiveFrom = body.effective_from || today;

    if (!/^\d+(?:\.\d{1,2})?$/.test(salaryText) ||
        !Number.isFinite(salary) || salary < 0 || salary > 999999999999.99) {
        return { valid: false, message: "Enter a valid salary with no more than two decimal places" };
    }
    if (!/^[A-Z]{3}$/.test(currencyCode)) {
        return { valid: false, message: "Enter a valid three-letter currency code" };
    }
    if (!["hourly", "weekly", "monthly", "yearly"].includes(payFrequency)) {
        return { valid: false, message: "Select a valid pay frequency" };
    }
    if (!isValidDateOnly(today) || !isValidDateOnly(effectiveFrom) || effectiveFrom < today) {
        return { valid: false, message: "Effective date must be a valid date and cannot be in the past" };
    }

    return { valid: true, salary, currencyCode, payFrequency, effectiveFrom };
};

module.exports = { isValidDateOnly, validateCompensationInput };
