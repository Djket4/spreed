<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2023 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Listener;

use OCA\Talk\Events\BeforeRoomsFetchEvent;
use OCA\Talk\Service\NoteToSelfService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;

/**
 * @template-implements IEventListener<Event>
 */
class NoteToSelfListener implements IEventListener {
	public function __construct(
		private readonly NoteToSelfService $service,
	) {
	}

	#[\Override]
	public function handle(Event $event): void {
		// ket4tec: «Личные заметки» сами не создаются (в облаке KET4TEC служебные беседы не показываем).
		// Явный запрос /room/note-to-self (ensureNoteToSelfExistsForUser) остаётся для клиентов, которые его зовут.
		return;
		// @phpstan-ignore-next-line deadCode.unreachable
		if ($event instanceof BeforeRoomsFetchEvent) {
			$this->service->initialCreateNoteToSelfForUser($event->getUserId());
		}
	}
}
