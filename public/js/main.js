// Utah Home Ready Check - Main JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Format currency inputs
    document.querySelectorAll('.currency-input').forEach(input => {
        input.addEventListener('input', function(e) {
            let value = e.target.value.replace(/[^0-9]/g, '');
            if (value) {
                e.target.value = parseInt(value).toLocaleString();
            }
        });

        input.addEventListener('blur', function(e) {
            let value = e.target.value.replace(/[^0-9]/g, '');
            if (value) {
                e.target.value = '$' + parseInt(value).toLocaleString();
            }
        });

        input.addEventListener('focus', function(e) {
            let value = e.target.value.replace(/[^0-9]/g, '');
            e.target.value = value;
        });
    });

    // Format phone inputs
    document.querySelectorAll('.phone-input').forEach(input => {
        input.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 10) value = value.substring(0, 10);

            if (value.length >= 6) {
                e.target.value = '(' + value.substring(0, 3) + ') ' + value.substring(3, 6) + '-' + value.substring(6);
            } else if (value.length >= 3) {
                e.target.value = '(' + value.substring(0, 3) + ') ' + value.substring(3);
            } else if (value.length > 0) {
                e.target.value = '(' + value;
            }
        });
    });
});

// Get raw currency value for form submission
function getCurrencyValue(input) {
    return parseInt(input.value.replace(/[^0-9]/g, '')) || 0;
}

// Show/hide sections based on conditions
function toggleSection(sectionId, show) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = show ? 'block' : 'none';
    }
}
