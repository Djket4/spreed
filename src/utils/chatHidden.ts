/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { ATTENDEE, PARTICIPANT } from '../constants.ts'

/**
 * ket4tec #55: guests (incl. email guests) without the chat permission
 * see no chat at all. Mirrors Participant::cannotSeeChat() on the server.
 *
 * @param actorType actor type of the current participant
 * @param permissions effective conversation permissions
 */
export function isChatHiddenForActor(actorType: string | null, permissions: number | undefined): boolean {
	return (actorType === ATTENDEE.ACTOR_TYPE.GUESTS || actorType === ATTENDEE.ACTOR_TYPE.EMAILS)
		&& permissions !== undefined
		&& !(permissions & PARTICIPANT.PERMISSIONS.CHAT)
}
