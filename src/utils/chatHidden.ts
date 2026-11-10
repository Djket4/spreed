/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { ATTENDEE } from '../constants.ts'

/**
 * ket4tec #55: guests (incl. email guests) never see chat, in every conversation
 * and call (решение Андрея 10.11). Mirrors Participant::cannotSeeChat() on the server.
 *
 * @param actorType actor type of the current participant
 */
export function isChatHiddenForActor(actorType: string | null): boolean {
	return actorType === ATTENDEE.ACTOR_TYPE.GUESTS || actorType === ATTENDEE.ACTOR_TYPE.EMAILS
}
