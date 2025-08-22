import { z } from 'zod';

// Base message schema
export const BaseMessageSchema = z.object({
    type: z.string(),
    payload: z.unknown()
});

// Join room message
export const JoinRoomMessageSchema = BaseMessageSchema.extend({
    type: z.literal('join'),
    payload: z.object({
        roomId: z.string()
    })
});

// Start quiz message
export const StartQuizMessageSchema = BaseMessageSchema.extend({
    type: z.literal('startQuiz'),
    payload: z.object({
        roomId: z.string()
    })
});

// Submit answer message
export const SubmitAnswerMessageSchema = BaseMessageSchema.extend({
    type: z.literal('submitAnswer'),
    payload: z.object({
        roomId: z.string(),
        questionIndex: z.number().int().min(0).max(9),
        choiceIdx: z.number().int().min(0).max(3)
    })
});

// Leave room message
export const LeaveRoomMessageSchema = BaseMessageSchema.extend({
    type: z.literal('leaveRoom'),
    payload: z.object({
        roomId: z.string()
    })
});

// Combined message schema
export const WebSocketMessageSchema = z.discriminatedUnion('type', [
    JoinRoomMessageSchema,
    StartQuizMessageSchema,
    SubmitAnswerMessageSchema,
    LeaveRoomMessageSchema
]);

// Response message schemas
export const ErrorResponseSchema = z.object({
    type: z.literal('error'),
    payload: z.object({
        code: z.number(),
        message: z.string()
    })
});

export const JoinedRoomResponseSchema = z.object({
    type: z.literal('joinedRoom'),
    payload: z.object({
        roomId: z.string()
    })
});

export const NextQuestionResponseSchema = z.object({
    type: z.literal('nextQuestion'),
    payload: z.object({
        questionIndex: z.number(),
        question: z.object({
            id: z.number(),
            text: z.string(),
            options: z.array(z.string()),
            correctIdx: z.number()
        }),
        startedAt: z.string(),
        expiresAt: z.string()
    })
});

export const EndQuestionResponseSchema = z.object({
    type: z.literal('endQuestion'),
    payload: z.object({
        questionIndex: z.number(),
        correctIdx: z.number(),
        winnerUserId: z.number().nullable()
    })
});

export const ParticipantLeftResponseSchema = z.object({
    type: z.literal('participantLeft'),
    payload: z.object({
        userId: z.number()
    })
});

export const QuizFinishedResponseSchema = z.object({
    type: z.literal('quizFinished'),
    payload: z.object({
        standings: z.array(z.object({
            userId: z.number(),
            score: z.number(),
            newRating: z.number()
        }))
    })
});

// Type exports
export type WebSocketMessage = z.infer<typeof WebSocketMessageSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type JoinedRoomResponse = z.infer<typeof JoinedRoomResponseSchema>;
export type NextQuestionResponse = z.infer<typeof NextQuestionResponseSchema>;
export type EndQuestionResponse = z.infer<typeof EndQuestionResponseSchema>;
export type ParticipantLeftResponse = z.infer<typeof ParticipantLeftResponseSchema>;
export type QuizFinishedResponse = z.infer<typeof QuizFinishedResponseSchema>;

// Custom error class
export class WebSocketError extends Error {
    constructor(
        public code: number,
        message: string
    ) {
        super(message);
        this.name = 'WebSocketError';
    }
} 