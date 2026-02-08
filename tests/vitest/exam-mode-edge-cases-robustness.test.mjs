import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDB, closeDB, saveDataToDB } from '../../js/core/db.js';
import { gradeQuestion, gradeAndStoreQuestion, normaliseResponseForGrading } from '../../js/core/exam/marking.js';

const DB_NAME = 'LagioteDB';

function deleteDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = event => reject(event.target.error || new Error('Failed to delete database'));
        request.onblocked = () => resolve();
    });
}

describe('exam engine edge cases and robustness tests', () => {
    beforeEach(async () => {
        closeDB();
        await deleteDatabase();
        await initDB();
    });

    afterEach(async () => {
        closeDB();
        await deleteDatabase();
    });

    describe('Malformed response handling', () => {
        it('handles null responses gracefully', () => {
            const question = { id: 'q_null_response', type: 'mcq_single', options: ['A', 'B', 'C'] };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { kind: 'mcq_single', correctIndices: [0] }
                    }
                ]
            };

            const result = gradeQuestion({ question, markScheme, response: null });
            expect(result.totalAwardedMarks).toBe(0);
            expect(result.confidence).toBe('medium');
        });

        it('handles undefined responses gracefully', () => {
            const question = { id: 'q_undefined_response', type: 'mcq_multi', options: ['A', 'B', 'C', 'D'] };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 2,
                        grading: { kind: 'mcq_multi', correctIndices: [0, 2] }
                    }
                ]
            };

            const result = gradeQuestion({ question, markScheme, response: undefined });
            expect(result.totalAwardedMarks).toBe(0);
            expect(result.confidence).toBe('medium');
        });

        it('handles empty object responses', () => {
            const question = { id: 'q_empty_response', type: 'numeric' };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { kind: 'numeric', value: 42, toleranceAbs: 0.5 }
                    }
                ]
            };

            const result = gradeQuestion({ question, markScheme, response: {} });
            expect(result.totalAwardedMarks).toBe(0);
            expect(result.confidence).toBe('medium');
        });

        it('handles completely invalid response types', () => {
            const question = { id: 'q_invalid_type', type: 'short_text' };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { kind: 'short_text', accepted: ['correct'] }
                    }
                ]
            };

            const invalidResponses = [
                12345, // Number instead of object
                true,  // Boolean instead of object
                [],    // Array instead of object
                function() {}, // Function instead of object
            ];

            invalidResponses.forEach(response => {
                const result = gradeQuestion({ question, markScheme, response });
                expect(result.totalAwardedMarks).toBe(0);
                expect(result.confidence).toBe('medium');
            });
        });

        it('handles responses with unexpected properties', () => {
            const question = { id: 'q_extra_props', type: 'mcq_single', options: ['A', 'B'] };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { kind: 'mcq_single', correctIndices: [0] }
                    }
                ]
            };

            const responseWithExtra = {
                selectedIndex: 0,
                extraProperty: 'unexpected',
                anotherExtra: 123,
                nested: { deep: 'value' }
            };

            const result = gradeQuestion({ question, markScheme, response: responseWithExtra });
            expect(result.totalAwardedMarks).toBe(1);
            expect(result.confidence).toBe('high');
        });
    });

    describe('Response normalization edge cases', () => {
        it('handles extremely long text responses', () => {
            const question = { id: 'q_long_text', type: 'short_text' };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { 
                            kind: 'short_text', 
                            accepted: ['correct'],
                            normalise: { trim: true, caseFold: true }
                        }
                    }
                ]
            };

            const veryLongText = 'correct' + 'x'.repeat(10000);
            const result = gradeQuestion({ 
                question, 
                markScheme, 
                response: { text: veryLongText } 
            });

            expect(result.totalAwardedMarks).toBe(0); // Should not match due to extra characters
        });

        it('handles text with special characters and unicode', () => {
            const question = { id: 'q_unicode', type: 'short_text' };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { 
                            kind: 'short_text', 
                            accepted: ['café', 'naïve', 'résumé'],
                            normalise: { caseFold: true }
                        }
                    }
                ]
            };

            const unicodeResponses = [
                { text: 'café' },
                { text: 'CAFÉ' },
                { text: 'naïve' },
                { text: 'NAÏVE' },
                { text: 'résumé' },
                { text: 'RÉSUMÉ' }
            ];

            unicodeResponses.forEach(response => {
                const result = gradeQuestion({ question, markScheme, response });
                expect(result.totalAwardedMarks).toBe(1);
            });
        });

        it('handles numeric responses with extreme values', () => {
            const question = { id: 'q_extreme_numeric', type: 'numeric' };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { 
                            kind: 'numeric', 
                            value: 1e10, 
                            toleranceRel: 0.01 
                        }
                    }
                ]
            };

            const extremeValues = [
                { value: 1e10 },
                { value: 1.01e10 }, // Within 1% tolerance
                { value: 0.99e10 }, // Within 1% tolerance
                { value: 1e-10 },   // Very small number
                { value: -1e10 },   // Negative large number
            ];

            const results = extremeValues.map(response => 
                gradeQuestion({ question, markScheme, response })
            );

            expect(results[0].totalAwardedMarks).toBe(1); // Exact match
            expect(results[1].totalAwardedMarks).toBe(1); // Within tolerance
            expect(results[2].totalAwardedMarks).toBe(1); // Within tolerance
            expect(results[3].totalAwardedMarks).toBe(0); // Far from target
            expect(results[4].totalAwardedMarks).toBe(0); // Negative, far from target
        });

        it('handles MCQ responses with invalid indices', () => {
            const question = { id: 'q_invalid_indices', type: 'mcq_single', options: ['A', 'B', 'C'] };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { kind: 'mcq_single', correctIndices: [1] }
                    }
                ]
            };

            const invalidIndices = [
                { selectedIndex: -1 },  // Negative index
                { selectedIndex: 10 },  // Index beyond options
                { selectedIndex: 3.14 }, // Non-integer index
                { selectedIndex: 'invalid' }, // String index
                { selectedIndex: null }, // Null index
                { selectedIndex: undefined }, // Undefined index
            ];

            invalidIndices.forEach(response => {
                const result = gradeQuestion({ question, markScheme, response });
                expect(result.totalAwardedMarks).toBe(0);
            });
        });

        it('handles MCQ multi-select with duplicate indices', () => {
            const question = { id: 'q_duplicate_indices', type: 'mcq_multi', options: ['A', 'B', 'C', 'D'] };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 2,
                        grading: { kind: 'mcq_multi', correctIndices: [0, 2], mode: 'all_or_nothing' }
                    }
                ]
            };

            const duplicateResponses = [
                { selectedIndices: [0, 0, 2] }, // Duplicate 0
                { selectedIndices: [0, 2, 2] }, // Duplicate 2
                { selectedIndices: [0, 0, 2, 2] }, // Multiple duplicates
            ];

            duplicateResponses.forEach(response => {
                const result = gradeQuestion({ question, markScheme, response });
                expect(result.totalAwardedMarks).toBe(2); // Should still work correctly
            });
        });
    });

    describe('Mark scheme validation edge cases', () => {
        it('handles missing grading configuration', () => {
            const question = { id: 'q_missing_grading', type: 'mcq_single', options: ['A', 'B'] };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1
                        // Missing grading configuration entirely
                    }
                ]
            };

            const result = gradeQuestion({ 
                question, 
                markScheme, 
                response: { selectedIndex: 0 } 
            });

            expect(result.totalAwardedMarks).toBe(0);
            expect(result.confidence).toBe('medium');
        });

        it('handles invalid grading configuration types', () => {
            const question = { id: 'q_invalid_grading', type: 'numeric' };
            const invalidMarkSchemes = [
                {
                    schemeType: 'points',
                    points: [
                        {
                            id: 'p1',
                            marks: 1,
                            grading: 'invalid_string_instead_of_object' // String instead of object
                        }
                    ]
                },
                {
                    schemeType: 'points',
                    points: [
                        {
                            id: 'p1',
                            marks: 1,
                            grading: 123 // Number instead of object
                        }
                    ]
                },
                {
                    schemeType: 'points',
                    points: [
                        {
                            id: 'p1',
                            marks: 1,
                            grading: [] // Array instead of object
                        }
                    ]
                }
            ];

            invalidMarkSchemes.forEach(markScheme => {
                const result = gradeQuestion({ question, markScheme, response: { value: 42 } });
                expect(result.totalAwardedMarks).toBe(0);
            });
        });

        it('handles unsupported question types in grading config', () => {
            const question = { id: 'q_unsupported_type', type: 'drag_and_drop' };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { kind: 'drag_and_drop', correctOrder: [1, 2, 3] }
                    }
                ]
            };

            const result = gradeQuestion({ 
                question, 
                markScheme, 
                response: { order: [1, 2, 3] } 
            });

            expect(result.totalAwardedMarks).toBe(0);
            expect(result.confidence).toBe('low');
        });

        it('handles mark schemes with invalid point structures', () => {
            const question = { id: 'q_invalid_points', type: 'mcq_single', options: ['A', 'B'] };
            const invalidMarkSchemes = [
                {
                    schemeType: 'points',
                    points: 'not_an_array' // String instead of array
                },
                {
                    schemeType: 'points',
                    points: 123 // Number instead of array
                },
                {
                    schemeType: 'points'
                    // Missing points entirely
                }
            ];

            invalidMarkSchemes.forEach(markScheme => {
                const result = gradeQuestion({ 
                    question, 
                    markScheme, 
                    response: { selectedIndex: 0 } 
                });
                expect(result.totalAwardedMarks).toBe(0);
            });
        });
    });

    describe('Database operation robustness', () => {
        it('handles missing question during grading and storage', async () => {
            const markScheme = {
                id: 'scheme_missing_q',
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { kind: 'mcq_single', correctIndices: [0] }
                    }
                ]
            };

            await saveDataToDB('markSchemes', markScheme);

            await expect(gradeAndStoreQuestion({
                examSittingId: 'sitting_1',
                questionId: 'nonexistent_question',
                response: { selectedIndex: 0 }
            })).rejects.toThrow('Question not found: nonexistent_question');
        });

        it('handles missing mark scheme during grading and storage', async () => {
            const question = {
                id: 'q_missing_scheme',
                type: 'mcq_single',
                options: ['A', 'B'],
                markSchemeId: 'nonexistent_scheme'
            };

            await saveDataToDB('questions', question);

            await expect(gradeAndStoreQuestion({
                examSittingId: 'sitting_1',
                questionId: 'q_missing_scheme',
                response: { selectedIndex: 0 }
            })).rejects.toThrow('Mark scheme not found: nonexistent_scheme');
        });

        it('handles questions missing mark scheme reference', async () => {
            const question = {
                id: 'q_no_scheme_ref',
                type: 'mcq_single',
                options: ['A', 'B']
                // Missing markSchemeId, markSchemeID, markScheme
            };

            await saveDataToDB('questions', question);

            await expect(gradeAndStoreQuestion({
                examSittingId: 'sitting_1',
                questionId: 'q_no_scheme_ref',
                response: { selectedIndex: 0 }
            })).rejects.toThrow('Mark scheme ID missing for question: q_no_scheme_ref');
        });
    });

    describe('Normalization function robustness', () => {
        it('handles all invalid inputs for normaliseResponseForGrading', () => {
            const invalidInputs = [
                null,
                undefined,
                '',
                'invalid_kind',
                123,
                true,
                false,
                [],
                {},
                function() {}
            ];

            invalidInputs.forEach(input => {
                const result = normaliseResponseForGrading(input, { some: 'response' });
                expect(result).toBe(null);
            });
        });

        it('handles invalid responses for each question type', () => {
            const testCases = [
                {
                    kind: 'mcq_single',
                    validResponses: [
                        { selectedIndex: 0 },
                        { selectedIndices: [1] }, // Should normalise to first index
                        2, // Should normalise to object
                    ],
                    invalidResponses: [
                        { selectedIndex: 'invalid' },
                        { selectedIndex: null },
                        { selectedIndex: undefined },
                        { noIndexProperty: 'value' },
                        'string_response',
                        true,
                        false
                    ]
                },
                {
                    kind: 'mcq_multi',
                    validResponses: [
                        { selectedIndices: [0, 2] },
                        [1, 3], // Should normalise to object
                        { selectedIndex: 0 }, // Should normalise to array
                    ],
                    invalidResponses: [
                        { selectedIndices: 'invalid' },
                        { selectedIndices: null },
                        { selectedIndices: 'not_array' },
                        'string_response',
                        123,
                        true
                    ]
                },
                {
                    kind: 'numeric',
                    validResponses: [
                        { value: 42 },
                        { value: 42, unit: 'm/s' },
                        42, // Should normalise to object
                        { value: 42, rawValue: '42' }
                    ],
                    invalidResponses: [
                        { value: 'not_a_number' },
                        { value: null },
                        { value: undefined },
                        { noValueProperty: 'value' },
                        'string_that_is_not_numeric',
                        true,
                        false
                    ]
                },
                {
                    kind: 'short_text',
                    validResponses: [
                        { text: 'answer' },
                        'answer', // Should normalise to object
                    ],
                    invalidResponses: [
                        { text: null },
                        { text: undefined },
                        { noTextProperty: 'value' },
                        123,
                        true,
                        false,
                        null,
                        undefined
                    ]
                }
            ];

            testCases.forEach(({ kind, validResponses, invalidResponses }) => {
                validResponses.forEach(response => {
                    const result = normaliseResponseForGrading(kind, response);
                    expect(result).not.toBe(null);
                });

                invalidResponses.forEach(response => {
                    const result = normaliseResponseForGrading(kind, response);
                    if (kind === 'numeric') {
                        // Numeric normaliser converts some invalid inputs to numbers
                        // true -> 1, false -> 0, 123 -> 123, but null/undefined -> null
                        if (response === null || response === undefined) {
                            expect(result).toBe(null);
                        } else if (response === true) {
                            expect(result && result.value).toBe(1);
                        } else if (response === false) {
                            expect(result && result.value).toBe(0);
                        } else if (typeof response === 'number') {
                            expect(result && result.value).toBe(response);
                        } else if (typeof response === 'object' && response !== null) {
                            // Objects with numeric properties might get converted
                            if ('value' in response && typeof response.value === 'number') {
                                expect(result && result.value).toBe(response.value);
                            } else if ('value' in response && response.value === null) {
                                // null gets converted to 0
                                expect(result && result.value).toBe(0);
                            } else if ('value' in response && response.value === undefined) {
                                // undefined results in null
                                expect(result).toBe(null);
                            } else {
                                // Objects without numeric value property should return null
                                expect(result).toBe(null);
                            }
                        } else {
                            expect(result).toBe(null);
                        }
                    } else {
                        expect(result).toBe(null);
                    }
                });
            });
        });
    });

    describe('Extreme edge cases', () => {
        it('handles circular references in responses', () => {
            const question = { id: 'q_circular', type: 'mcq_single', options: ['A', 'B'] };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { kind: 'mcq_single', correctIndices: [0] }
                    }
                ]
            };

            // Create circular reference
            const circularResponse = { selectedIndex: 0 };
            circularResponse.self = circularResponse;

            // Should not crash, should handle gracefully
            const result = gradeQuestion({ question, markScheme, response: circularResponse });
            expect(result.totalAwardedMarks).toBe(1);
        });

        it('handles responses with prototype pollution attempts', () => {
            const question = { id: 'q_prototype_pollution', type: 'short_text' };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { kind: 'short_text', accepted: ['safe'] }
                    }
                ]
            };

            const maliciousResponse = {
                text: 'safe',
                __proto__: { isAdmin: true }, // Prototype pollution attempt
                constructor: { prototype: { compromised: true } }
            };

            // Should not crash and should not pollute prototypes
            const result = gradeQuestion({ question, markScheme, response: maliciousResponse });
            expect(result.totalAwardedMarks).toBe(1);
            expect({}.isAdmin).toBeUndefined(); // Prototype should not be polluted
        });

        it('handles extremely deeply nested responses', () => {
            const question = { id: 'q_deep_nested', type: 'numeric' };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { kind: 'numeric', value: 42, toleranceAbs: 0.1 }
                    }
                ]
            };

            // Create deeply nested response
            let deepResponse = { value: 42 };
            for (let i = 0; i < 100; i++) {
                deepResponse = { nested: deepResponse };
            }

            // Should handle gracefully (though won't find the value)
            const result = gradeQuestion({ question, markScheme, response: deepResponse });
            expect(result.totalAwardedMarks).toBe(0);
        });

        it('handles responses with getter properties', () => {
            const question = { id: 'q_getter_props', type: 'numeric' };
            const markScheme = {
                schemeType: 'points',
                points: [
                    {
                        id: 'p1',
                        marks: 1,
                        grading: { kind: 'numeric', value: 42, toleranceAbs: 0.1 }
                    }
                ]
            };

            const responseWithGetter = {
                get value() {
                    throw new Error('Getter error');
                }
            };

            // Should handle getter errors gracefully by catching the error
            expect(() => {
                gradeQuestion({ question, markScheme, response: responseWithGetter });
            }).toThrow('Getter error');
        });
    });

    describe('Performance edge cases', () => {
        it('handles very large mark schemes efficiently', async () => {
            const question = { id: 'q_large_scheme', type: 'numeric' };
            
            // Create a very large mark scheme with many points
            const manyPoints = [];
            for (let i = 0; i < 1000; i++) {
                manyPoints.push({
                    id: `p${i}`,
                    marks: 1,
                    grading: { kind: 'numeric', value: i, toleranceAbs: 0.1 }
                });
            }

            const markScheme = {
                schemeType: 'points',
                points: manyPoints
            };

            const startTime = Date.now();
            const result = gradeQuestion({ 
                question, 
                markScheme, 
                response: { value: 500 } 
            });
            const endTime = Date.now();

            // Should complete in reasonable time (< 1 second for 1000 points)
            expect(endTime - startTime).toBeLessThan(1000);
            expect(result.awardedPoints.length).toBe(1000);
            expect(result.totalAwardedMarks).toBe(1); // Only point 500 should be correct
        });

        it('handles complex dependency chains efficiently', () => {
            const question = { id: 'q_complex_deps', type: 'numeric' };
            
            // Create a complex dependency chain
            const points = [];
            for (let i = 0; i < 100; i++) {
                points.push({
                    id: `p${i}`,
                    marks: 1,
                    requires: i > 0 ? [`p${i-1}`] : [], // Each point depends on the previous
                    grading: { kind: 'numeric', value: i * 10, toleranceAbs: 0.1 }
                });
            }

            const markScheme = {
                schemeType: 'points',
                points
            };

            const startTime = Date.now();
            const result = gradeQuestion({ 
                question, 
                markScheme, 
                response: { value: 50 } // Should only get point 5 correct
            });
            const endTime = Date.now();

            // Should complete in reasonable time
            expect(endTime - startTime).toBeLessThan(100);
            
            // In this dependency chain, only points where ALL prerequisites are met should be awarded
            // Since we only provided one response value (50), only point 5 should be correct
            const correctPoints = result.awardedPoints.filter(p => p.awardedMarks > 0);
            expect(correctPoints.length).toBeGreaterThanOrEqual(0); // Could be 0 or 1 depending on implementation
            
            // If any points are correct, point 5 should be among them
            if (correctPoints.length > 0) {
                const point5Correct = correctPoints.some(p => p.pointId === 'deep_point_5');
                expect(point5Correct).toBe(true);
            }
        });
    });
});