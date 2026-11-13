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
use OCP\BackgroundJob\IJobList;
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
	public const GRACE = 120;

	public function __construct(
		ITimeFactory $time,
		private readonly Manager $manager,
		private readonly RoomService $roomService,
		private readonly ParticipantService $participantService,
		private readonly IAppConfig $appConfig,
		private readonly IJobList $jobList,
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

		if ($emptySince + self::GRACE > $this->time->getTime()) {
			// отсрочка ещё не истекла: не спим в cron, а ставим задачу заново на момент её конца
			$argument = ['roomId' => $roomId];
			if (!$this->jobList->has(self::class, $argument)) {
				$this->jobList->scheduleAfter(self::class, $emptySince + self::GRACE, $argument);
			}
			return;
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

		$this->roomService->resetActiveSince($room, null, $emptySince);
	}
}
