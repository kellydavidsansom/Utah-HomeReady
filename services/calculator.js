/**
 * Calculator Service
 * Handles readiness scoring and affordability calculations
 */

const DEBT_MIDPOINTS = {
    'Under $200': 100,
    '$200 - $499': 350,
    '$500 - $799': 650,
    '$800 - $1,199': 1000,
    '$1,200 - $1,799': 1500,
    '$1,800 - $2,499': 2150,
    '$2,500+': 3000
};

/**
 * Calculate readiness score from 0-100
 */
function calculateReadinessScore(lead) {
    let score = 0;

    // Credit Score (30 points max)
    const creditScores = {
        'Excellent (740+)': 30,
        'Good (670-739)': 25,
        'Fair (580-669)': 15,
        "Needs Work (below 580)": 5,
        "I don't know": 10
    };
    score += creditScores[lead.credit_score_range] || 0;

    // Down Payment (25 points max)
    const combinedIncome = (lead.gross_annual_income || 0) + (lead.coborrower_gross_annual_income || 0);
    const estimatedHomePrice = combinedIncome * 4; // Rough estimate
    const downPaymentPercent = estimatedHomePrice > 0
        ? ((lead.down_payment_saved || 0) / estimatedHomePrice) * 100
        : 0;

    if (downPaymentPercent >= 20) score += 25;
    else if (downPaymentPercent >= 10) score += 20;
    else if (downPaymentPercent >= 5) score += 15;
    else if (downPaymentPercent >= 3.5) score += 10;
    else score += 5;

    // Employment Stability (15 points max)
    const stableEmployment = ['W-2 Employee (traditional job)', 'Retired'];
    if (stableEmployment.includes(lead.employment_type)) score += 15;
    else if (lead.employment_type === 'Self-Employed') score += 10;
    else score += 5;

    // Time at Address (10 points max)
    const addressScores = {
        '2+ years': 10,
        '1-2 years': 7,
        'Less than 1 year': 4
    };
    score += addressScores[lead.time_at_address] || 0;

    // Timeline (10 points max)
    const timelineScores = {
        'ASAP - ready now!': 10,
        '1-3 months': 10,
        '3-6 months': 8,
        '6-12 months': 5,
        '12+ months': 3,
        'Just exploring options': 2
    };
    score += timelineScores[lead.timeline] || 0;

    // DTI Health (10 points max)
    const monthlyIncome = combinedIncome / 12;
    const monthlyDebt = DEBT_MIDPOINTS[lead.monthly_debt_payments] || 500;
    const currentDTI = monthlyIncome > 0 ? (monthlyDebt / monthlyIncome) * 100 : 100;

    if (currentDTI < 20) score += 10;
    else if (currentDTI < 30) score += 8;
    else if (currentDTI < 40) score += 5;
    else score += 2;

    return Math.min(score, 100);
}

/**
 * Determine readiness level (green, yellow, red)
 */
function determineReadinessLevel(score, lead) {
    // Check for automatic red light conditions
    if (lead.credit_score_range === "Needs Work (below 580)") {
        return { level: 'red', reason: 'credit' };
    }

    const combinedIncome = (lead.gross_annual_income || 0) + (lead.coborrower_gross_annual_income || 0);
    const monthlyIncome = combinedIncome / 12;
    const monthlyDebt = DEBT_MIDPOINTS[lead.monthly_debt_payments] || 500;

    // If DTI already over 45% before housing, red light for income
    if (monthlyIncome > 0 && (monthlyDebt / monthlyIncome) > 0.45) {
        return { level: 'red', reason: 'income' };
    }

    // If down payment is less than $3,000 and timeline is urgent
    const urgentTimelines = ['ASAP - ready now!', '1-3 months'];
    if ((lead.down_payment_saved || 0) < 3000 && urgentTimelines.includes(lead.timeline)) {
        return { level: 'red', reason: 'down_payment' };
    }

    // Score-based levels (being liberal as requested)
    if (score >= 65) return { level: 'green', reason: null };
    if (score >= 45) return { level: 'yellow', reason: null };
    return { level: 'red', reason: 'overall' };
}

/**
 * Calculate affordability at different DTI levels
 */
function calculateAffordability(lead) {
    const combinedIncome = (lead.gross_annual_income || 0) + (lead.coborrower_gross_annual_income || 0);
    const monthlyIncome = combinedIncome / 12;
    const monthlyDebt = DEBT_MIDPOINTS[lead.monthly_debt_payments] || 500;
    const downPayment = lead.down_payment_saved || 0;

    // Calculate max housing payment at each DTI level
    const comfortable = (0.32 * monthlyIncome) - monthlyDebt; // 32% DTI
    const stretch = (0.36 * monthlyIncome) - monthlyDebt;     // 36% DTI
    const strained = (0.40 * monthlyIncome) - monthlyDebt;    // 40% DTI

    // Convert monthly payment to home price and loan amount
    function paymentToPriceAndLoan(monthlyPayment) {
        if (monthlyPayment <= 0) return { homePrice: 0, loanAmount: 0 };

        // Assumptions: 5.8% interest, 30-year term (current market rates)
        const interestRate = 0.058;
        const monthlyRate = interestRate / 12;
        const numPayments = 360;

        // P&I is about 78% of total payment (22% for taxes, insurance, PMI)
        const piPayment = monthlyPayment * 0.78;

        // P&I = P * [r(1+r)^n] / [(1+r)^n - 1]
        const factor = (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
                       (Math.pow(1 + monthlyRate, numPayments) - 1);

        const loanAmount = piPayment / factor;

        // Home price = loan amount + down payment
        const homePrice = loanAmount + downPayment;

        return {
            homePrice: Math.round(homePrice / 5000) * 5000, // Round to nearest $5k
            loanAmount: Math.round(loanAmount / 1000) * 1000 // Round to nearest $1k
        };
    }

    const comfortableResult = paymentToPriceAndLoan(comfortable);
    const stretchResult = paymentToPriceAndLoan(stretch);
    const strainedResult = paymentToPriceAndLoan(strained);

    return {
        comfortable: Math.max(0, comfortableResult.homePrice),
        stretch: Math.max(0, stretchResult.homePrice),
        strained: Math.max(0, strainedResult.homePrice),
        loanAmounts: {
            comfortable: Math.max(0, comfortableResult.loanAmount),
            stretch: Math.max(0, stretchResult.loanAmount),
            strained: Math.max(0, strainedResult.loanAmount)
        },
        monthlyPayments: {
            comfortable: Math.max(0, Math.round(comfortable)),
            stretch: Math.max(0, Math.round(stretch)),
            strained: Math.max(0, Math.round(strained))
        },
        downPayment: downPayment
    };
}

/**
 * Process a lead and calculate all results
 */
function processLead(lead) {
    const score = calculateReadinessScore(lead);
    const { level, reason } = determineReadinessLevel(score, lead);
    const affordability = calculateAffordability(lead);

    return {
        readiness_score: score,
        readiness_level: level,
        red_light_reason: reason,
        comfortable_price: affordability.comfortable,
        stretch_price: affordability.stretch,
        strained_price: affordability.strained,
        comfortable_loan: affordability.loanAmounts.comfortable,
        stretch_loan: affordability.loanAmounts.stretch,
        strained_loan: affordability.loanAmounts.strained,
        comfortable_payment: affordability.monthlyPayments.comfortable,
        stretch_payment: affordability.monthlyPayments.stretch,
        strained_payment: affordability.monthlyPayments.strained,
        down_payment_display: affordability.downPayment
    };
}

module.exports = {
    calculateReadinessScore,
    determineReadinessLevel,
    calculateAffordability,
    processLead,
    DEBT_MIDPOINTS
};
