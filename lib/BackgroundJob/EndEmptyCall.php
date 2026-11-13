<?php

declare(strict_types=1);

/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\BackgroundJob;

use OCA\Talk\Exceptions\RoomNotFoundException;
use OCA\Talk\Manager;
use OCA\Talk\Service\ParticipantService;
use OCA\Talk\Service\RoomService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\QueuedJob;

/**
 * ket4tec (NAS_CLOUD#129): звонок заканчивается не сразу, когда вышел последний участник,
 * а на ближайшем тике cron и только если комната по-прежнему пуста. Переключение устройства
 * (leave на одном, join на другом через 1-2 с) больше не завершает звонок и не перезапускает запись.
 * Аргумент: ['roomId' => int]. Задержка = период cron (на боевом 5 минут).
 */
class EndEmptyCall extends QueuedJob {
	public function __construct(
		ITimeFactory $time,
		private readonly Manager $manager,
		private readonly RoomService $roomService,
		private readonly ParticipantService $participantService,
	) {
		parent::__construct($time);
	}

	#[\Override]
	protected function run($argument): void {
		try {
			$room = $this->manager->getRoomById((int)($argument['roomId'] ?? 0));
		} catch (RoomNotFoundException) {
			return;
		}

		if ($this->participantService->hasActiveSessionsInCall($room)) {
			return; // кто-то вошёл: звонок продолжается
		}

		$this->roomService->resetActiveSince($room, null);
	}
}
