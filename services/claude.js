/**
 * Claude AI Integration
 * Generates personalized summaries and action items for leads
 */

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Generate AI summary for a lead's results
 */
async function generateAISummary(lead, agent) {
    const combinedIncome = (lead.gross_annual_income || 0) + (lead.coborrower_gross_annual_income || 0);

    let targetCounties = [];
    let downPaymentSources = [];
    try {
        targetCounties = JSON.parse(lead.target_counties || '[]');
        downPaymentSources = JSON.parse(lead.down_payment_sources || '[]');
    } catch (e) {
        console.error('Error parsing JSON fields:', e);
    }

    const prompt = `You are a friendly mortgage advisor helping someone understand their home buying readiness.

Here's their information:
- Name: ${lead.first_name} ${lead.last_name}
${lead.has_coborrower ? `- Co-Borrower: ${lead.coborrower_first_name} ${lead.coborrower_last_name}` : ''}
- Combined Annual Income: $${combinedIncome.toLocaleString()}
- Employment: ${lead.employment_type}${lead.coborrower_employment_type ? ` / ${lead.coborrower_employment_type}` : ''}
- Monthly Debts: ${lead.monthly_debt_payments}
- Credit Score Range: ${lead.credit_score_range}
- Down Payment Saved: $${(lead.down_payment_saved || 0).toLocaleString()}
- Down Payment Sources: ${downPaymentSources.join(', ') || 'Not specified'}
- Timeline: ${lead.timeline}
- Target Areas: ${targetCounties.join(', ') || 'Utah'}
- First-Time Buyer: ${lead.first_time_buyer}
- VA Eligible: ${lead.va_eligible}
- Current Housing: ${lead.current_housing}

Their Readiness Level: ${lead.readiness_level.toUpperCase()} LIGHT
${lead.red_light_reason ? `Red Light Reason: ${lead.red_light_reason}` : ''}

Affordability:
- Comfortable (32% DTI): Up to $${(lead.comfortable_price || 0).toLocaleString()}
- Stretch (36% DTI): Up to $${(lead.stretch_price || 0).toLocaleString()}
- Strained (40% DTI): Up to $${(lead.strained_price || 0).toLocaleString()}

Write a 2-3 paragraph personalized summary that:
1. Addresses them by first name
2. Acknowledges their strengths (be encouraging!)
3. ${lead.readiness_level === 'green' ? 'Congratulates them on being ready and encourages them to get pre-approved' : lead.readiness_level === 'yellow' ? 'Explains they are close and what small steps would help' : 'Kindly explains what they need to work on and that it is achievable'}
4. Mentions their affordability range naturally
5. Is warm, encouraging, and never condescending
6. Keeps it simple - no jargon
7. If they are VA eligible, mention VA loans as a great option

Do NOT use bullet points. Write in conversational paragraphs.`;

    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            messages: [{ role: 'user', content: prompt }]
        });

        return response.content[0].text;
    } catch (error) {
        console.error('Error generating AI summary:', error.message);
        // Return a fallback summary
        return generateFallbackSummary(lead);
    }
}

/**
 * Generate action items for a lead
 */
async function generateActionItems(lead) {
    const prompt = `Based on this home buyer's profile, generate 3-5 specific, actionable next steps.

Profile:
- Readiness Level: ${lead.readiness_level}
- Red Light Reason: ${lead.red_light_reason || 'N/A'}
- Credit Score: ${lead.credit_score_range}
- Down Payment: $${(lead.down_payment_saved || 0).toLocaleString()}
- Timeline: ${lead.timeline}
- First-Time Buyer: ${lead.first_time_buyer}
- VA Eligible: ${lead.va_eligible}

Return a JSON array of action items, each with:
- title: Short action title (5-7 words max)
- description: 1-2 sentence explanation
- priority: "high", "medium", or "low"
- category: "credit", "savings", "documents", "education", or "next_step"

Example format:
[
  {
    "title": "Get Pre-Approved This Week",
    "description": "You're ready! Getting pre-approved will give you a competitive edge when making offers.",
    "priority": "high",
    "category": "next_step"
  }
]

Return ONLY the JSON array, no other text.`;

    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            messages: [{ role: 'user', content: prompt }]
        });

        const text = response.content[0].text;
        // Extract JSON from response
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return getDefaultActionItems(lead);
    } catch (error) {
        console.error('Error generating action items:', error.message);
        return getDefaultActionItems(lead);
    }
}

/**
 * Analyze credit reports for red light credit leads
 */
async function analyzeCreditReports(lead, reportTexts) {
    const prompt = `You are a credit improvement specialist. Analyze these credit reports and provide guidance.

${Object.entries(reportTexts).map(([bureau, text]) => `
--- ${bureau.toUpperCase()} REPORT ---
${text}
`).join('\n')}

Create TWO outputs:

**OUTPUT 1 - FOR THE CLIENT (store as client_summary):**
Write a friendly, encouraging 2-3 paragraph summary that:
- Acknowledges where they are
- Highlights 3-5 specific, actionable steps they can take to improve
- Gives realistic timeline expectations
- Is encouraging and never shaming
- Uses simple language

**OUTPUT 2 - FOR KELLY THE LOAN OFFICER (store as kelly_report):**
Write a detailed analysis including:
- Current estimated score range
- All negative items identified (collections, late payments, etc.)
- Recommended dispute opportunities
- Payment history analysis
- Credit utilization analysis
- Account age considerations
- Specific strategies to improve score by 50+ points
- Estimated timeline to reach 620+ score
- Any red flags Kelly should discuss with them

Format your response as JSON:
{
  "client_summary": "...",
  "kelly_report": "..."
}`;

    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            messages: [{ role: 'user', content: prompt }]
        });

        const text = response.content[0].text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        throw new Error('Could not parse credit analysis response');
    } catch (error) {
        console.error('Error analyzing credit reports:', error.message);
        throw error;
    }
}

/**
 * Generate income/down payment boost ideas
 */
async function generateBoostIdeas(lead) {
    let targetCounties = [];
    try {
        targetCounties = JSON.parse(lead.target_counties || '[]');
    } catch (e) {}

    const prompt = `Generate personalized ideas for someone who needs to either increase income or save more for a down payment.

Their situation:
- Current Income: $${(lead.gross_annual_income || 0).toLocaleString()}/year
- Employment Type: ${lead.employment_type}
- Current Down Payment Saved: $${(lead.down_payment_saved || 0).toLocaleString()}
- Timeline: ${lead.timeline}
- Location: ${targetCounties.join(', ') || 'Utah'}
- First-Time Buyer: ${lead.first_time_buyer}
- Red Light Reason: ${lead.red_light_reason}

Provide:

**PART 1 - INCOME BOOST IDEAS:**
5-7 realistic side hustle or income increase ideas based on their situation. Be specific to Utah when possible.

**PART 2 - DOWN PAYMENT SOURCES:**
List all potential down payment sources they might not have considered:
- Utah-specific down payment assistance programs
- FHA loans (3.5% down)
- VA loans if eligible (0% down)
- Gift funds rules
- 401k loan options
- Employer programs
- Other creative sources

**PART 3 - SAVINGS STRATEGIES:**
3-5 specific strategies to accelerate savings

Format as JSON:
{
  "income_ideas": [
    {"title": "...", "description": "...", "potential_monthly": "$X-$Y"}
  ],
  "down_payment_sources": [
    {"source": "...", "description": "...", "amount_possible": "..."}
  ],
  "savings_strategies": [
    {"title": "...", "description": "..."}
  ]
}`;

    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1500,
            messages: [{ role: 'user', content: prompt }]
        });

        const text = response.content[0].text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        throw new Error('Could not parse boost ideas response');
    } catch (error) {
        console.error('Error generating boost ideas:', error.message);
        throw error;
    }
}

// Fallback functions
function generateFallbackSummary(lead) {
    if (lead.readiness_level === 'green') {
        return `Great news, ${lead.first_name}! Based on your financial profile, you're in a strong position to buy a home. Your income, savings, and credit put you in a good place to start the home buying process.

You could comfortably look at homes up to $${(lead.comfortable_price || 0).toLocaleString()}, with some flexibility to stretch to $${(lead.stretch_price || 0).toLocaleString()} if you find the perfect place. The next step is getting fully pre-approved so you can make competitive offers with confidence.

Let's connect to get your pre-approval started and find your dream home in Utah!`;
    } else if (lead.readiness_level === 'yellow') {
        return `${lead.first_name}, you're close to being ready to buy a home! Your financial foundation is solid, and with a few adjustments, you'll be in an even stronger position.

Based on your current situation, you could look at homes around $${(lead.comfortable_price || 0).toLocaleString()}. With some preparation over the next few months, you might be able to increase that range even further.

Let's talk about what steps would help you the most and create a plan to get you fully ready.`;
    } else {
        return `${lead.first_name}, thank you for taking the time to complete this assessment. While there are some areas we'll want to work on together, homeownership is absolutely within reach for you.

Many people start exactly where you are and successfully buy homes within 6-12 months. The key is having a clear plan and taking consistent steps forward.

Let's connect to discuss your specific situation and create a roadmap to get you home-ready.`;
    }
}

function getDefaultActionItems(lead) {
    if (lead.readiness_level === 'green') {
        return [
            {
                title: "Get Pre-Approved Now",
                description: "You're ready! Getting pre-approved will give you a competitive edge when making offers.",
                priority: "high",
                category: "next_step"
            },
            {
                title: "Connect With Your Agent",
                description: "Start looking at homes in your target areas and price range.",
                priority: "high",
                category: "next_step"
            },
            {
                title: "Gather Your Documents",
                description: "Have pay stubs, tax returns, and bank statements ready for the pre-approval process.",
                priority: "medium",
                category: "documents"
            }
        ];
    } else if (lead.readiness_level === 'yellow') {
        return [
            {
                title: "Schedule a Consultation",
                description: "Let's review your specific situation and create a plan to get you fully ready.",
                priority: "high",
                category: "next_step"
            },
            {
                title: "Continue Saving",
                description: "Keep building your down payment - every extra dollar helps.",
                priority: "medium",
                category: "savings"
            },
            {
                title: "Check Your Credit Report",
                description: "Review your credit reports for any errors or quick wins.",
                priority: "medium",
                category: "credit"
            }
        ];
    } else {
        return [
            {
                title: "Let's Talk About Your Plan",
                description: "Schedule a call to discuss your path to homeownership.",
                priority: "high",
                category: "next_step"
            },
            {
                title: "Review Your Credit",
                description: "Understanding your credit is the first step to improving it.",
                priority: "high",
                category: "credit"
            },
            {
                title: "Explore Assistance Programs",
                description: "There may be programs that can help with your down payment.",
                priority: "medium",
                category: "education"
            }
        ];
    }
}

module.exports = {
    generateAISummary,
    generateActionItems,
    analyzeCreditReports,
    generateBoostIdeas
};
