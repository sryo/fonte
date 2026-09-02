export const AUTOMATION_EVENTS = {
    TRIGGERED: 'automation:triggered',
    EXECUTED: 'automation:executed',
    FINISHED: 'automation:finished',
    FAILED: 'automation:failed',
    ERROR: 'automation:error',
    CREATED: 'automation:created',
    UPDATED: 'automation:updated',
    DELETED: 'automation:deleted',
} as const;

export const AUTOMATION_WAKE_CUE = '[automation]';

/** A reply consisting only of this token is not delivered anywhere. */
export const AUTOMATION_QUIET_REPLY = '[quiet]';
