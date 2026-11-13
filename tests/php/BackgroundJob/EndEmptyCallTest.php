<?php

declare(strict_types=1);
/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Tests\BackgroundJob;

use OCA\Talk\BackgroundJob\EndEmptyCall;
use OCA\Talk\Exceptions\RoomNotFoundException;
use OCA\Talk\Manager;
use OCA\Talk\Room;
use OCA\Talk\Service\ParticipantService;
use OCA\Talk\Service\RoomService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\IAppConfig;
use PHPUnit\Framework\MockObject\MockObject;
use Test\TestCase;

class EndEmptyCallTest extends TestCase {
	protected Manager&MockObject $manager;
	protected RoomService&MockObject $roomService;
	protected ParticipantService&MockObject $participantService;
	protected IAppConfig&MockObject $appConfig;
	protected ITimeFactory&MockObject $time;
	protected IJobList&MockObject $jobList;

	public function setUp(): void {
		parent::setUp();
		$this->manager = $this->createMock(Manager::class);
		$this->roomService = $this->createMock(RoomService::class);
		$this->participantService = $this->createMock(ParticipantService::class);
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->jobList = $this->createMock(IJobList::class);
		$this->time = $this->createMock(ITimeFactory::class);
		$this->time->method('getTime')->willReturn(1000);
	}

	protected function run42(): void {
		$job = new EndEmptyCall($this->time, $this->manager, $this->roomService, $this->participantService, $this->appConfig, $this->jobList);
		self::invokePrivate($job, 'run', [['roomId' => 42]]);
	}

	public function testEndsCallWhenStillEmpty(): void {
		$this->appConfig->method('getValueInt')->willReturn(800);
		$room = $this->createMock(Room::class);
		$this->manager->method('getRoomById')->with(42)->willReturn($room);
		$this->participantService->method('hasActiveSessionsInCall')->willReturn(false);
		$this->roomService->expects($this->once())->method('resetActiveSince')->with($room, null, 800);
		$this->run42();
	}

	public function testKeepsCallWhenSomeoneJoined(): void {
		$this->appConfig->method('getValueInt')->willReturn(800);
		$room = $this->createMock(Room::class);
		$this->manager->method('getRoomById')->willReturn($room);
		$this->participantService->method('hasActiveSessionsInCall')->willReturn(true);
		$this->roomService->expects($this->never())->method('resetActiveSince');
		$this->run42();
	}

	public function testDeletedRoomIsIgnored(): void {
		$this->appConfig->method('getValueInt')->willReturn(800);
		$this->manager->method('getRoomById')->willThrowException(new RoomNotFoundException());
		$this->roomService->expects($this->never())->method('resetActiveSince');
		$this->run42();
	}

	public function testNothingWhenSomeoneJoinedAfterEmptied(): void {
		$this->appConfig->method('getValueInt')->willReturn(0); // joinCall снял отметку
		$this->manager->expects($this->never())->method('getRoomById');
		$this->roomService->expects($this->never())->method('resetActiveSince');
		$this->run42();
	}

	public function testStaleCacheIsDroppedBeforeEveryRead(): void {
		// без clearCache() второе чтение вернуло бы старое значение; здесь проверяем порядок: clearCache перед каждым getValueInt
		$calls = [];
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->appConfig->method('clearCache')->willReturnCallback(function () use (&$calls): void {
			$calls[] = 'clear';
		});
		$this->appConfig->method('getValueInt')->willReturnCallback(function () use (&$calls): int {
			$calls[] = 'read';
			return 0;
		});
		$this->run42();
		$this->assertSame(['clear', 'read'], $calls);
	}

	public function testNotYetDueIsRescheduledWithoutSleep(): void {
		// отметка 986, now 1000: отсрочка (120 с) не истекла: задача ставится заново на 986+120, звонок не трогаем
		$this->appConfig->method('getValueInt')->willReturn(986);
		$this->jobList->method('has')->willReturn(false);
		$this->jobList->expects($this->once())->method('scheduleAfter')->with(EndEmptyCall::class, 986 + EndEmptyCall::GRACE, ['roomId' => 42]);
		$this->manager->expects($this->never())->method('getRoomById');
		$this->roomService->expects($this->never())->method('resetActiveSince');
		$this->run42();
	}

	public function testNotYetDueNotDuplicatedWhenJobExists(): void {
		$this->appConfig->method('getValueInt')->willReturn(986);
		$this->jobList->method('has')->willReturn(true);
		$this->jobList->expects($this->never())->method('scheduleAfter');
		$this->run42();
	}

	public function testReturnWithin120sKeepsCall(): void {
		// кто-то вернулся: отметки нет, звонок не закрывается
		$this->appConfig->method('getValueInt')->willReturn(0);
		$this->roomService->expects($this->never())->method('resetActiveSince');
		$this->run42();
	}
}
