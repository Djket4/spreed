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
use PHPUnit\Framework\MockObject\MockObject;
use Test\TestCase;

class EndEmptyCallTest extends TestCase {
	protected Manager&MockObject $manager;
	protected RoomService&MockObject $roomService;
	protected ParticipantService&MockObject $participantService;

	public function setUp(): void {
		parent::setUp();
		$this->manager = $this->createMock(Manager::class);
		$this->roomService = $this->createMock(RoomService::class);
		$this->participantService = $this->createMock(ParticipantService::class);
	}

	protected function run42(): void {
		$job = new EndEmptyCall($this->createMock(ITimeFactory::class), $this->manager, $this->roomService, $this->participantService);
		self::invokePrivate($job, 'run', [['roomId' => 42]]);
	}

	public function testEndsCallWhenStillEmpty(): void {
		$room = $this->createMock(Room::class);
		$this->manager->method('getRoomById')->with(42)->willReturn($room);
		$this->participantService->method('hasActiveSessionsInCall')->willReturn(false);
		$this->roomService->expects($this->once())->method('resetActiveSince')->with($room, null);
		$this->run42();
	}

	public function testKeepsCallWhenSomeoneJoined(): void {
		$room = $this->createMock(Room::class);
		$this->manager->method('getRoomById')->willReturn($room);
		$this->participantService->method('hasActiveSessionsInCall')->willReturn(true);
		$this->roomService->expects($this->never())->method('resetActiveSince');
		$this->run42();
	}

	public function testDeletedRoomIsIgnored(): void {
		$this->manager->method('getRoomById')->willThrowException(new RoomNotFoundException());
		$this->roomService->expects($this->never())->method('resetActiveSince');
		$this->run42();
	}
}
