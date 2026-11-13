<?php

declare(strict_types=1);
/**
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Tests\php\Service;

use OCA\Talk\BackgroundJob\EndEmptyCall;
use OCA\Talk\Config;
use OCA\Talk\Federation\BackendNotifier;
use OCA\Talk\Model\AttendeeMapper;
use OCA\Talk\Model\SessionMapper;
use OCA\Talk\Participant;
use OCA\Talk\Room;
use OCA\Talk\Service\MembershipService;
use OCA\Talk\Service\ParticipantService;
use OCA\Talk\Service\SessionService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\Federation\ICloudIdManager;
use OCP\IAppConfig;
use OCP\ICacheFactory;
use OCP\IDBConnection;
use OCP\IGroupManager;
use OCP\IUserManager;
use OCP\Security\ISecureRandom;
use OCP\UserStatus\IManager;
use PHPUnit\Framework\MockObject\MockObject;
use Psr\Log\LoggerInterface;
use Test\TestCase;

/**
 * NAS_CLOUD#129: все пути выхода (leaveCall, leaveRoom, HPB leave) идут в resetCallStateWhenNeeded,
 * которая откладывает завершение пустого звонка, а не вызывает resetActiveSince.
 */
class ParticipantServiceEmptyCallTest extends TestCase {
	private IAppConfig&MockObject $appConfig;
	private IJobList&MockObject $jobList;

	private function service(bool $hasActive): ParticipantService {
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getTime')->willReturn(1000);
		$this->appConfig = $this->createMock(IAppConfig::class);
		$this->jobList = $this->createMock(IJobList::class);
		return $this->getMockBuilder(ParticipantService::class)
			->setConstructorArgs([
				$this->createMock(Config::class),
				$this->createMock(AttendeeMapper::class),
				$this->createMock(SessionMapper::class),
				$this->createMock(SessionService::class),
				$this->createMock(ISecureRandom::class),
				$this->createMock(IDBConnection::class),
				$this->createMock(IEventDispatcher::class),
				$this->createMock(IUserManager::class),
				$this->createMock(ICloudIdManager::class),
				$this->createMock(IGroupManager::class),
				$this->createMock(MembershipService::class),
				$this->createMock(BackendNotifier::class),
				$time,
				$this->createMock(ICacheFactory::class),
				$this->createMock(IManager::class),
				$this->createMock(LoggerInterface::class),
				$this->appConfig,
				$this->jobList,
			])
			->onlyMethods(['hasActiveSessionsInCall'])
			->getMock();
	}

	private function room(int $flag): Room&MockObject {
		$room = $this->createMock(Room::class);
		$room->method('getId')->willReturn(42);
		$room->method('getCallFlag')->willReturn($flag);
		return $room;
	}

	public function testEmptyCallIsMarkedAndJobQueued(): void {
		$service = $this->service(false);
		$service->method('hasActiveSessionsInCall')->willReturn(false);
		$this->appConfig->expects($this->once())->method('setValueInt')->with('spreed', EndEmptyCall::key(42), 1000);
		$this->jobList->method('has')->willReturn(false);
		$this->jobList->expects($this->once())->method('add')->with(EndEmptyCall::class, ['roomId' => 42]);
		$service->resetCallStateWhenNeeded($this->room(Participant::FLAG_IN_CALL));
	}

	public function testNothingWhenOthersStillInCall(): void {
		$service = $this->service(true);
		$service->method('hasActiveSessionsInCall')->willReturn(true);
		$this->appConfig->expects($this->never())->method('setValueInt');
		$this->jobList->expects($this->never())->method('add');
		$service->resetCallStateWhenNeeded($this->room(Participant::FLAG_IN_CALL));
	}

	public function testNothingWhenNoCall(): void {
		$service = $this->service(false);
		$this->appConfig->expects($this->never())->method('setValueInt');
		$this->jobList->expects($this->never())->method('add');
		$service->resetCallStateWhenNeeded($this->room(Participant::FLAG_DISCONNECTED));
	}
}
