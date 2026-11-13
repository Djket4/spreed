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
use OCP\IAppConfig;

/**
 * ket4tec (NAS_CLOUD#129): звонок заканчивается не сразу, когда вышел последний участник,
 * а на ближайшем тике cron, не раньше чем через GRACE секунд после опустения и только если
 * комната по-прежнему пуста. Переключение устройства (leave, через 1-2 с join) не завершает звонок.
 * Аргумент: ['roomId' => int]. Момент опустения лежит в app config {@see self::key()}: его ставит
 * leaveCall, снимает joinCall (кто-то вошёл) или эта задача.
 */
class EndEmptyCall extends QueuedJob {
	public const GRACE = 15;

	public function __construct(
		ITimeFactory $time,
		private readonly Manager $manager,
		private readonly RoomService $roomService,
		private readonly ParticipantService $participantService,
		private readonly IAppConfig $appConfig,
	) {
		parent::__construct($time);
	}

	public static function key(int $roomId): string {
		return 'empty_call_' . $roomId;
	}

	/** Процесс cron долгоживущий: кэш app config может быть старым, сбрасываем перед каждым чтением. */
	private function readMark(int $roomId): int {
		$this->appConfig->clearCache();
		return $this->appConfig->getValueInt('spreed', self::key($roomId), 0);
	}

	#[\Override]
	protected function run($argument): void {
		$roomId = (int)($argument['roomId'] ?? 0);
		$emptySince = $this->readMark($roomId);
		if ($emptySince <= 0) {
			return; // кто-то вошёл после опустения (или звонок уже закончен)
		}

		$wait = $emptySince + self::GRACE - $this->time->getTime();
		if ($wait > 0) {
			// ponytail: тик cron пришёл раньше GRACE (редко, окно 15 с из 300): ждём остаток в самой задаче, не более GRACE
			sleep(min($wait, self::GRACE));
			if ($this->readMark($roomId) !== $emptySince) {
				return; // кто-то вошёл (или опустело заново и ждёт свою задачу)
			}
		}

		$this->appConfig->deleteKey('spreed', self::key($roomId));
		try {
			$room = $this->manager->getRoomById($roomId);
		} catch (RoomNotFoundException) {
			return;
		}

		if ($this->participantService->hasActiveSessionsInCall($room)) {
			return;
		}

		$this->roomService->resetActiveSince($room, null);
	}
}
