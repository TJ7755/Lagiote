;(function () {
    const STEP_PREFIX_REGEX = /^\s*(?:\d+[\.\)]|\(\d+\)|[-\u2013\u2014\u2022\u2023\u2024\u25E6])\s*/;

    function convertStepToString(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' || typeof value === 'number') return String(value);
        if (typeof value === 'object') {
            return String(
                value.answer ||
                value.term ||
                value.step ||
                value.text ||
                value.label ||
                value.value ||
                value.question ||
                ''
            );
        }
        return '';
    }

    function cleanStepText(value) {
        const text = convertStepToString(value);
        const sanitized = text.replace(STEP_PREFIX_REGEX, '');
        return sanitized.trim();
    }

    const helpers = {
        STEP_PREFIX_REGEX,
        convertStepToString,
        cleanStepText
    };

    if (typeof window !== 'undefined') {
        if (!window.sequenceStepUtils) {
            window.sequenceStepUtils = helpers;
        } else {
            Object.assign(window.sequenceStepUtils, helpers);
        }
    }
})();
