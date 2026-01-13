import { z } from "zod";
// Roster item validation
export const rosterItemSchema = z.object({
    jerseyNo: z.number().int().min(1).max(99),
    name: z.string().max(50).optional(),
});
// Formation assignment validation
export const formationAssignmentSchema = z.object({
    jerseyNo: z.number().int().min(1).max(99),
    role: z.string().max(30).optional(),
    slot: z
        .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
    })
        .optional(),
});
// Camera settings validation
export const cameraSettingsSchema = z
    .object({
    position: z.enum(["sideline", "goalLine", "corner", "other"]).nullable().optional(),
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
    headingDeg: z.number().min(0).max(360).optional(),
    zoomHint: z.enum(["near", "mid", "far"]).nullable().optional(),
})
    .nullable()
    .optional();
// Team colors validation (hex color format)
export const teamColorsSchema = z
    .object({
    home: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color format")
        .nullable()
        .optional(),
    away: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color format")
        .nullable()
        .optional(),
})
    .nullable()
    .optional();
// Formation validation
export const formationSchema = z
    .object({
    shape: z.string().max(20).nullable().optional(),
    assignments: z.array(formationAssignmentSchema).optional(),
})
    .nullable()
    .optional();
// Game format validation (11v11, 8v8, 5v5)
export const gameFormatSchema = z.enum(["eleven", "eight", "five"]);
// Match duration validation
export const matchDurationSchema = z
    .object({
    halfDuration: z.number().int().min(5).max(60),
    numberOfHalves: z.number().int().min(1).max(4),
    extraTime: z.boolean().optional(),
})
    .nullable()
    .optional();
// Field size validation (in meters)
export const fieldSizeSchema = z
    .object({
    length: z.number().min(20).max(120),
    width: z.number().min(15).max(90),
})
    .nullable()
    .optional();
// Processing mode validation
export const processingModeSchema = z.enum(["quick", "standard", "detailed"]);
// Full match settings validation
export const matchSettingsSchema = z.object({
    attackDirection: z.enum(["LTR", "RTL"]).nullable().optional(),
    relabelOnChange: z.boolean().optional(),
    camera: cameraSettingsSchema,
    teamColors: teamColorsSchema,
    formation: formationSchema,
    gameFormat: gameFormatSchema.nullable().optional(),
    matchDuration: matchDurationSchema,
    fieldSize: fieldSizeSchema,
    processingMode: processingModeSchema.nullable().optional(),
});
// Default settings validation
export const defaultSettingsSchema = z.object({
    gameFormat: gameFormatSchema.optional(),
    teamColors: z
        .object({
        home: z.string().optional(),
        away: z.string().optional(),
    })
        .optional(),
    formation: z
        .object({
        shape: z.string().optional(),
    })
        .optional(),
    roster: z.array(rosterItemSchema).optional(),
});
// Validation helper functions
export function validateMatchSettings(data) {
    return matchSettingsSchema.safeParse(data);
}
export function validateDefaultSettings(data) {
    return defaultSettingsSchema.safeParse(data);
}
// Check for duplicate jersey numbers
export function findDuplicateJerseyNumbers(roster) {
    const seen = new Set();
    const duplicates = [];
    for (const player of roster) {
        if (seen.has(player.jerseyNo)) {
            if (!duplicates.includes(player.jerseyNo)) {
                duplicates.push(player.jerseyNo);
            }
        }
        else {
            seen.add(player.jerseyNo);
        }
    }
    return duplicates;
}
