/**
 * HighLevel CRM Integration
 * Sends leads to HighLevel via webhook when assessment is completed
 */

const HIGHLEVEL_WEBHOOK_URL = process.env.HIGHLEVEL_WEBHOOK_URL;

/**
 * Send lead to HighLevel CRM
 * @param {Object} lead - The lead data from database
 * @param {Object} agent - The agent associated with the lead (optional)
 * @returns {Promise<Object>} - Response from HighLevel
 */
async function sendToHighLevel(lead, agent = null) {
    if (!HIGHLEVEL_WEBHOOK_URL) {
        console.log('HighLevel webhook URL not configured, skipping...');
        return { skipped: true };
    }

    try {
        // Map readiness level to tags
        const readinessTag = {
            'green': 'Home Ready - Green Light',
            'yellow': 'Home Ready - Yellow Light',
            'red': 'Home Ready - Red Light'
        }[lead.readiness_level] || 'Home Ready Assessment';

        // Parse JSON fields
        let targetCounties = [];
        let downPaymentSources = [];
        try {
            targetCounties = JSON.parse(lead.target_counties || '[]');
            downPaymentSources = JSON.parse(lead.down_payment_sources || '[]');
        } catch (e) {
            console.error('Error parsing JSON fields:', e);
        }

        // Build the payload for HighLevel
        const payload = {
            // Contact info
            firstName: lead.first_name,
            lastName: lead.last_name,
            email: lead.email,
            phone: lead.phone,

            // Address
            address1: lead.street_address,
            city: lead.city,
            state: lead.state || 'Utah',
            postalCode: lead.zip,

            // Source tracking
            source: 'Utah Home Ready Check',
            tags: [readinessTag],

            // Custom fields - adjust these to match your HighLevel custom fields
            customField: {
                // Readiness info
                readiness_score: lead.readiness_score,
                readiness_level: lead.readiness_level,
                red_light_reason: lead.red_light_reason || '',

                // Financial info
                gross_annual_income: lead.gross_annual_income,
                monthly_debt_payments: lead.monthly_debt_payments,
                credit_score_range: lead.credit_score_range,
                down_payment_saved: lead.down_payment_saved,
                down_payment_sources: downPaymentSources.join(', '),
                employment_type: lead.employment_type,

                // Affordability
                comfortable_price: lead.comfortable_price,
                stretch_price: lead.stretch_price,
                strained_price: lead.strained_price,

                // Buying plans
                timeline: lead.timeline,
                target_counties: targetCounties.join(', '),
                first_time_buyer: lead.first_time_buyer,
                va_eligible: lead.va_eligible,
                current_housing: lead.current_housing,

                // Co-borrower
                has_coborrower: lead.has_coborrower ? 'Yes' : 'No',
                coborrower_name: lead.has_coborrower
                    ? `${lead.coborrower_first_name} ${lead.coborrower_last_name}`
                    : '',
                coborrower_email: lead.coborrower_email || '',

                // Agent info
                referring_agent: agent ? `${agent.first_name} ${agent.last_name}` : '',
                referring_agent_email: agent ? agent.email : '',
                referring_agent_brokerage: agent ? agent.brokerage : '',

                // AI Summary
                ai_summary: lead.ai_summary || ''
            }
        };

        console.log('Sending lead to HighLevel:', lead.email);

        const response = await fetch(HIGHLEVEL_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HighLevel webhook failed: ${response.status} - ${errorText}`);
        }

        const result = await response.json().catch(() => ({ success: true }));
        console.log('Lead sent to HighLevel successfully');
        return result;

    } catch (error) {
        console.error('Error sending to HighLevel:', error.message);
        // Don't throw - we don't want to break the flow if HighLevel fails
        return { error: error.message };
    }
}

/**
 * Send a contact update to HighLevel (for status changes)
 */
async function updateHighLevelContact(email, updates) {
    if (!HIGHLEVEL_WEBHOOK_URL) {
        return { skipped: true };
    }

    try {
        const payload = {
            email,
            ...updates
        };

        const response = await fetch(HIGHLEVEL_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HighLevel update failed: ${response.status}`);
        }

        return await response.json().catch(() => ({ success: true }));

    } catch (error) {
        console.error('Error updating HighLevel contact:', error.message);
        return { error: error.message };
    }
}

module.exports = {
    sendToHighLevel,
    updateHighLevelContact
};
