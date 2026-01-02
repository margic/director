# Example Data

## Race Session (Fresh)

```json
{
    "id": "58d0c41e-0554-4006-8fa3-b5cf244fb648",
    "raceSessionId": "58d0c41e-0554-4006-8fa3-b5cf244fb648",
    "name": "DirectorTest",
    "simulator": "iRacing",
    "directorSceneId": "3763277e-b7cb-4715-bb2f-9f77f8cc605b",
    "drivers": [
        {
            "id": "de564c70-4831-4780-a95d-47ae0047978e",
            "raceSessionDriverId": "f7428afb-e1cf-48ff-9075-037bc1e3716f",
            "raceSessionId": "58d0c41e-0554-4006-8fa3-b5cf244fb648",
            "driverId": "69ab10bc-ec63-424c-b625-9ba20c6e2c4b",
            "rigId": "db066d96-1c99-4fe0-b13a-807a2b1d7da0",
            "obsSceneId": "e086f376-9ce0-455a-9d38-c174a43d4b27",
            "carNumber": ""
        }
    ],
    "status": "active",
    "scheduledStart": "2026-01-01T22:19:35.371Z",
    "createdAt": "2026-01-01T22:19:35.371Z",
    "updatedAt": "2026-01-01T22:19:42.828Z",
    "createdBy": "e24e1f95-ef67-433d-8e1c-9fca1ae3be44",
    "createdByUserId": "e24e1f95-ef67-433d-8e1c-9fca1ae3be44",
    "centerId": "default-center",
    "_rid": "KBMqAJBEj4wdAAAAAAAAAA==",
    "_self": "dbs/KBMqAA==/colls/KBMqAJBEj4w=/docs/KBMqAJBEj4wdAAAAAAAAAA==/",
    "_etag": "\"0200032a-0000-4d00-0000-6956f2fe0000\"",
    "_attachments": "attachments/",
    "gatewayFqdn": "gateway.simracecenter.com",
    "gatewayStatus": "active",
    "_ts": 1767305982
}
```

## Race Session (With iRacing Data)

```json
{
    "id": "58d0c41e-0554-4006-8fa3-b5cf244fb648",
    "raceSessionId": "58d0c41e-0554-4006-8fa3-b5cf244fb648",
    "name": "DirectorTest",
    "simulator": "iRacing",
    "directorSceneId": "3763277e-b7cb-4715-bb2f-9f77f8cc605b",
    "drivers": [
        {
            "id": "de564c70-4831-4780-a95d-47ae0047978e",
            "raceSessionDriverId": "f7428afb-e1cf-48ff-9075-037bc1e3716f",
            "raceSessionId": "58d0c41e-0554-4006-8fa3-b5cf244fb648",
            "driverId": "69ab10bc-ec63-424c-b625-9ba20c6e2c4b",
            "rigId": "db066d96-1c99-4fe0-b13a-807a2b1d7da0",
            "obsSceneId": "e086f376-9ce0-455a-9d38-c174a43d4b27",
            "carNumber": ""
        }
    ],
    "status": "active",
    "scheduledStart": "2026-01-01T22:19:35.371Z",
    "createdAt": "2026-01-01T22:19:35.371Z",
    "updatedAt": "2026-01-01T22:19:42.828Z",
    "createdBy": "e24e1f95-ef67-433d-8e1c-9fca1ae3be44",
    "createdByUserId": "e24e1f95-ef67-433d-8e1c-9fca1ae3be44",
    "centerId": "default-center",
    "_rid": "KBMqAJBEj4wdAAAAAAAAAA==",
    "_self": "dbs/KBMqAA==/colls/KBMqAJBEj4w=/docs/KBMqAJBEj4wdAAAAAAAAAA==/",
    "_etag": "\"0200132a-0000-4d00-0000-6956f39b0000\"",
    "_attachments": "attachments/",
    "gatewayFqdn": "gateway.simracecenter.com",
    "gatewayStatus": "active",
    "iracing": {
        "CameraInfo": {
            "Groups": [
                {
                    "Cameras": [
                        {
                            "CameraName": "CamNose",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "Nose",
                    "GroupNum": 1
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamGearbox",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "Gearbox",
                    "GroupNum": 2
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamRoll Bar",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "Roll Bar",
                    "GroupNum": 3
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamLF Susp",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "LF Susp",
                    "GroupNum": 4
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamLR Susp",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "LR Susp",
                    "GroupNum": 5
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamGyro",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "Gyro",
                    "GroupNum": 6
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamRF Susp",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "RF Susp",
                    "GroupNum": 7
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamRR Susp",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "RR Susp",
                    "GroupNum": 8
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamCockpit",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "Cockpit",
                    "GroupNum": 9
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "Scenic_01",
                            "CameraNum": 1
                        },
                        {
                            "CameraName": "Scenic_02",
                            "CameraNum": 2
                        },
                        {
                            "CameraName": "Scenic_03",
                            "CameraNum": 3
                        },
                        {
                            "CameraName": "Scenic_04",
                            "CameraNum": 4
                        },
                        {
                            "CameraName": "Scenic_05",
                            "CameraNum": 5
                        },
                        {
                            "CameraName": "Scenic_06",
                            "CameraNum": 6
                        },
                        {
                            "CameraName": "Scenic_07",
                            "CameraNum": 7
                        },
                        {
                            "CameraName": "Scenic_08",
                            "CameraNum": 8
                        },
                        {
                            "CameraName": "Scenic_09",
                            "CameraNum": 9
                        },
                        {
                            "CameraName": "Scenic_10",
                            "CameraNum": 10
                        }
                    ],
                    "GroupName": "Scenic",
                    "GroupNum": 10,
                    "IsScenic": true
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamTV1_00",
                            "CameraNum": 1
                        },
                        {
                            "CameraName": "CamTV1_01",
                            "CameraNum": 2
                        },
                        {
                            "CameraName": "CamTV1_02",
                            "CameraNum": 3
                        },
                        {
                            "CameraName": "CamTV1_03",
                            "CameraNum": 4
                        },
                        {
                            "CameraName": "CamTV1_04",
                            "CameraNum": 5
                        },
                        {
                            "CameraName": "CamTV1_05",
                            "CameraNum": 6
                        },
                        {
                            "CameraName": "CamTV1_07",
                            "CameraNum": 7
                        },
                        {
                            "CameraName": "CamTV1_06",
                            "CameraNum": 8
                        },
                        {
                            "CameraName": "CamTV1_08",
                            "CameraNum": 9
                        },
                        {
                            "CameraName": "CamTV1_09",
                            "CameraNum": 10
                        },
                        {
                            "CameraName": "CamTV1_10",
                            "CameraNum": 11
                        },
                        {
                            "CameraName": "CamTV1_11",
                            "CameraNum": 12
                        }
                    ],
                    "GroupName": "TV1",
                    "GroupNum": 11
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamTV2_00",
                            "CameraNum": 1
                        },
                        {
                            "CameraName": "CamTV2_01",
                            "CameraNum": 2
                        },
                        {
                            "CameraName": "CamTV2_02",
                            "CameraNum": 3
                        },
                        {
                            "CameraName": "CamTV2_03",
                            "CameraNum": 4
                        },
                        {
                            "CameraName": "CamTV2_04",
                            "CameraNum": 5
                        },
                        {
                            "CameraName": "CamTV2_05",
                            "CameraNum": 6
                        },
                        {
                            "CameraName": "CamTV2_06",
                            "CameraNum": 7
                        },
                        {
                            "CameraName": "CamTV2_07",
                            "CameraNum": 8
                        },
                        {
                            "CameraName": "CamTV2_08",
                            "CameraNum": 9
                        },
                        {
                            "CameraName": "CamTV2_09",
                            "CameraNum": 10
                        },
                        {
                            "CameraName": "CamTV2_10",
                            "CameraNum": 11
                        },
                        {
                            "CameraName": "CamTV2_11",
                            "CameraNum": 12
                        }
                    ],
                    "GroupName": "TV2",
                    "GroupNum": 12
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamTV3_00",
                            "CameraNum": 1
                        },
                        {
                            "CameraName": "CamTV3_01",
                            "CameraNum": 2
                        },
                        {
                            "CameraName": "CamTV3_09",
                            "CameraNum": 3
                        },
                        {
                            "CameraName": "CamTV3_02",
                            "CameraNum": 4
                        },
                        {
                            "CameraName": "CamTV3_03",
                            "CameraNum": 5
                        },
                        {
                            "CameraName": "CamTV3_04",
                            "CameraNum": 6
                        },
                        {
                            "CameraName": "CamTV3_05",
                            "CameraNum": 7
                        },
                        {
                            "CameraName": "CamTV3_06",
                            "CameraNum": 8
                        },
                        {
                            "CameraName": "CamTV3_07",
                            "CameraNum": 9
                        },
                        {
                            "CameraName": "CamTV3_08",
                            "CameraNum": 10
                        }
                    ],
                    "GroupName": "TV3",
                    "GroupNum": 13
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamTV4_00",
                            "CameraNum": 1
                        },
                        {
                            "CameraName": "CamTV4_01",
                            "CameraNum": 2
                        },
                        {
                            "CameraName": "CamTV4_02",
                            "CameraNum": 3
                        },
                        {
                            "CameraName": "CamTV4_03",
                            "CameraNum": 4
                        },
                        {
                            "CameraName": "CamTV4_04",
                            "CameraNum": 5
                        },
                        {
                            "CameraName": "CamTV4_05",
                            "CameraNum": 6
                        },
                        {
                            "CameraName": "CamTV4_06",
                            "CameraNum": 7
                        },
                        {
                            "CameraName": "CamTV4_07",
                            "CameraNum": 8
                        },
                        {
                            "CameraName": "CamTV4_08",
                            "CameraNum": 9
                        },
                        {
                            "CameraName": "CamTV4_09",
                            "CameraNum": 10
                        },
                        {
                            "CameraName": "CamTV4_10",
                            "CameraNum": 11
                        },
                        {
                            "CameraName": "CamTV4_11",
                            "CameraNum": 12
                        },
                        {
                            "CameraName": "CamTV4_12",
                            "CameraNum": 13
                        },
                        {
                            "CameraName": "CamTV4_13",
                            "CameraNum": 14
                        },
                        {
                            "CameraName": "CamTV4_14",
                            "CameraNum": 15
                        },
                        {
                            "CameraName": "CamTV4_15",
                            "CameraNum": 16
                        }
                    ],
                    "GroupName": "TV Static",
                    "GroupNum": 14
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamTV3_00",
                            "CameraNum": 1
                        },
                        {
                            "CameraName": "CamTV1_00",
                            "CameraNum": 2
                        },
                        {
                            "CameraName": "CamTV1_01",
                            "CameraNum": 3
                        },
                        {
                            "CameraName": "CamTV1_02",
                            "CameraNum": 4
                        },
                        {
                            "CameraName": "CamTV1_03",
                            "CameraNum": 5
                        },
                        {
                            "CameraName": "CamTV1_04",
                            "CameraNum": 6
                        },
                        {
                            "CameraName": "CamTV1_05",
                            "CameraNum": 7
                        },
                        {
                            "CameraName": "CamTV1_06",
                            "CameraNum": 8
                        },
                        {
                            "CameraName": "CamTV1_07",
                            "CameraNum": 9
                        },
                        {
                            "CameraName": "CamTV1_08",
                            "CameraNum": 10
                        },
                        {
                            "CameraName": "CamTV1_09",
                            "CameraNum": 11
                        },
                        {
                            "CameraName": "CamTV1_10",
                            "CameraNum": 12
                        },
                        {
                            "CameraName": "CamTV1_11",
                            "CameraNum": 13
                        },
                        {
                            "CameraName": "CamTV2_00",
                            "CameraNum": 14
                        },
                        {
                            "CameraName": "CamTV2_01",
                            "CameraNum": 15
                        },
                        {
                            "CameraName": "CamTV2_02",
                            "CameraNum": 16
                        },
                        {
                            "CameraName": "CamTV2_03",
                            "CameraNum": 17
                        },
                        {
                            "CameraName": "CamTV2_04",
                            "CameraNum": 18
                        },
                        {
                            "CameraName": "CamTV2_05",
                            "CameraNum": 19
                        },
                        {
                            "CameraName": "CamTV2_06",
                            "CameraNum": 20
                        },
                        {
                            "CameraName": "CamTV2_07",
                            "CameraNum": 21
                        },
                        {
                            "CameraName": "CamTV2_08",
                            "CameraNum": 22
                        },
                        {
                            "CameraName": "CamTV2_09",
                            "CameraNum": 23
                        },
                        {
                            "CameraName": "CamTV2_10",
                            "CameraNum": 24
                        },
                        {
                            "CameraName": "CamTV2_11",
                            "CameraNum": 25
                        },
                        {
                            "CameraName": "CamTV3_01",
                            "CameraNum": 26
                        },
                        {
                            "CameraName": "CamTV3_02",
                            "CameraNum": 27
                        },
                        {
                            "CameraName": "CamTV3_03",
                            "CameraNum": 28
                        },
                        {
                            "CameraName": "CamTV3_04",
                            "CameraNum": 29
                        },
                        {
                            "CameraName": "CamTV3_05",
                            "CameraNum": 30
                        },
                        {
                            "CameraName": "CamTV3_06",
                            "CameraNum": 31
                        },
                        {
                            "CameraName": "CamTV3_07",
                            "CameraNum": 32
                        },
                        {
                            "CameraName": "CamTV3_08",
                            "CameraNum": 33
                        },
                        {
                            "CameraName": "CamTV3_09",
                            "CameraNum": 34
                        },
                        {
                            "CameraName": "CamTV4_00",
                            "CameraNum": 35
                        },
                        {
                            "CameraName": "CamTV4_01",
                            "CameraNum": 36
                        },
                        {
                            "CameraName": "CamTV4_02",
                            "CameraNum": 37
                        },
                        {
                            "CameraName": "CamTV4_03",
                            "CameraNum": 38
                        },
                        {
                            "CameraName": "CamTV4_04",
                            "CameraNum": 39
                        },
                        {
                            "CameraName": "CamTV4_05",
                            "CameraNum": 40
                        },
                        {
                            "CameraName": "CamTV4_06",
                            "CameraNum": 41
                        },
                        {
                            "CameraName": "CamTV4_07",
                            "CameraNum": 42
                        },
                        {
                            "CameraName": "CamTV4_08",
                            "CameraNum": 43
                        },
                        {
                            "CameraName": "CamTV4_09",
                            "CameraNum": 44
                        },
                        {
                            "CameraName": "CamTV4_10",
                            "CameraNum": 45
                        },
                        {
                            "CameraName": "CamTV4_11",
                            "CameraNum": 46
                        },
                        {
                            "CameraName": "CamTV4_12",
                            "CameraNum": 47
                        },
                        {
                            "CameraName": "CamTV4_13",
                            "CameraNum": 48
                        },
                        {
                            "CameraName": "CamTV4_14",
                            "CameraNum": 49
                        },
                        {
                            "CameraName": "CamTV4_15",
                            "CameraNum": 50
                        },
                        {
                            "CameraName": "CamRoll Bar",
                            "CameraNum": 51
                        }
                    ],
                    "GroupName": "TV Mixed",
                    "GroupNum": 15
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamPit Lane",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "Pit Lane",
                    "GroupNum": 16
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamPit Lane 2",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "Pit Lane 2",
                    "GroupNum": 17
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamBlimp",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "Blimp",
                    "GroupNum": 18
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamChopper",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "Chopper",
                    "GroupNum": 19
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamChase",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "Chase",
                    "GroupNum": 20
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamFar Chase",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "Far Chase",
                    "GroupNum": 21
                },
                {
                    "Cameras": [
                        {
                            "CameraName": "CamRear Chase",
                            "CameraNum": 1
                        }
                    ],
                    "GroupName": "Rear Chase",
                    "GroupNum": 22
                }
            ]
        },
        "CarSetup": {
            "Chassis": {
                "Front": {
                    "ArbSetting": 2,
                    "CrossWeight": "50.0%",
                    "NoseWeight": "53.0%",
                    "ToeIn": "-1.0 mm"
                },
                "InCarDials": {
                    "DscSetting": "MDM",
                    "ThrottleSetting": "Dry"
                },
                "LeftFront": {
                    "Camber": "-4.4 deg",
                    "CornerWeight": "4313 N",
                    "RideHeight": "125.2 mm",
                    "ShockSetting": "-3 clicks",
                    "SpringPerchOffset": "57.5 mm",
                    "SpringRate": "180 N/mm"
                },
                "LeftRear": {
                    "Camber": "-3.0 deg",
                    "CornerWeight": "3819 N",
                    "RideHeight": "125.5 mm",
                    "ShockSetting": "-4 clicks",
                    "SpringPerchOffset": "52.5 mm",
                    "SpringRate": "170 N/mm",
                    "ToeIn": "+1.7 mm"
                },
                "Rear": {
                    "ArbSetting": 1,
                    "FuelLevel": "44.0 L",
                    "WingSetting": -1.5
                },
                "RightFront": {
                    "Camber": "-4.4 deg",
                    "CornerWeight": "4308 N",
                    "RideHeight": "125.3 mm",
                    "ShockSetting": "-3 clicks",
                    "SpringPerchOffset": "57.5 mm",
                    "SpringRate": "180 N/mm"
                },
                "RightRear": {
                    "Camber": "-3.0 deg",
                    "CornerWeight": "3819 N",
                    "RideHeight": "125.5 mm",
                    "ShockSetting": "-4 clicks",
                    "SpringPerchOffset": "52.5 mm",
                    "SpringRate": "170 N/mm",
                    "ToeIn": "+1.7 mm"
                }
            },
            "Tires": {
                "LeftFront": {
                    "LastHotPressure": "179 kPa",
                    "LastTempsOMI": "47C, 47C, 47C",
                    "StartingPressure": "179 kPa",
                    "TreadRemaining": "100%, 100%, 100%"
                },
                "LeftRear": {
                    "LastHotPressure": "179 kPa",
                    "LastTempsOMI": "47C, 47C, 47C",
                    "StartingPressure": "179 kPa",
                    "TreadRemaining": "100%, 100%, 100%"
                },
                "RightFront": {
                    "LastHotPressure": "179 kPa",
                    "LastTempsIMO": "47C, 47C, 47C",
                    "StartingPressure": "179 kPa",
                    "TreadRemaining": "100%, 100%, 100%"
                },
                "RightRear": {
                    "LastHotPressure": "179 kPa",
                    "LastTempsIMO": "47C, 47C, 47C",
                    "StartingPressure": "179 kPa",
                    "TreadRemaining": "100%, 100%, 100%"
                },
                "TireType": {
                    "TireType": "Dry"
                }
            },
            "UpdateCount": 2
        },
        "DriverInfo": {
            "DriverBrakeCurvingFactor": 1.8,
            "DriverCarEngCylinderCount": 6,
            "DriverCarEstLapTime": 106.5963,
            "DriverCarFuelKgPerLtr": 0.75,
            "DriverCarFuelMaxLtr": 120,
            "DriverCarGearNeutral": 1,
            "DriverCarGearNumForward": 7,
            "DriverCarGearReverse": 1,
            "DriverCarIdleRPM": 950,
            "DriverCarIdx": 0,
            "DriverCarIsElectric": 0,
            "DriverCarMaxFuelPct": 1,
            "DriverCarRedLine": 7500,
            "DriverCarSLBlinkRPM": 6450,
            "DriverCarSLFirstRPM": 5500,
            "DriverCarSLLastRPM": 6100,
            "DriverCarSLShiftRPM": 6000,
            "DriverCarShiftAid": "Automatic",
            "DriverCarVersion": "2025.12.03.02",
            "DriverGearboxControlType": "Sequential",
            "DriverGearboxType": "Sequential",
            "DriverHeadPosX": -0.287,
            "DriverHeadPosY": 0.361,
            "DriverHeadPosZ": 0.727,
            "DriverIncidentCount": 4,
            "DriverIsAdmin": 1,
            "DriverPitTrkPct": 0.987873,
            "DriverSetupIsModified": 0,
            "DriverSetupLoadTypeName": "user",
            "DriverSetupName": "navarra.sto",
            "DriverSetupPassedTech": 1,
            "DriverTires": [
                {
                    "TireCompoundType": "Hard",
                    "TireIndex": 0
                },
                {
                    "TireCompoundType": "Wet",
                    "TireIndex": 1
                }
            ],
            "DriverUserID": 1300054,
            "Drivers": [
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 106.5963,
                    "CarClassID": 0,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 100,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "1,FF0000,00FF00,0000FF",
                    "CarID": 195,
                    "CarIdx": 0,
                    "CarIsAI": 0,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "64",
                    "CarNumberDesignStr": "0,0,FFFFFF,777777,000000",
                    "CarNumberRaw": 64,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 4,
                    "FaceType": 0,
                    "HelmetDesignStr": "1,FFFFFF,00A1E4,FFDE00",
                    "HelmetType": 0,
                    "IRating": 1,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": "0xundefined",
                    "LicLevel": 1,
                    "LicString": "R 0.01",
                    "LicSubLevel": 1,
                    "SuitDesignStr": "1,FFFFFF,00A1E4,FFDE00",
                    "TeamID": 0,
                    "TeamIncidentCount": 4,
                    "TeamName": "Paul Crofts4",
                    "UserID": 1300054,
                    "UserName": "Paul Crofts4"
                },
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 106.5963,
                    "CarClassID": 0,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 100,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "10,FFC600,004CB9,004CB9",
                    "CarID": 195,
                    "CarIdx": 1,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "1",
                    "CarNumberDesignStr": "0,0,,,",
                    "CarNumberRaw": 1,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 323,
                    "CarSponsor_2": 323,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "13,FFC600,004CB9,004CB9",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "31,FFC600,004CB9,004CB9",
                    "TeamID": 2,
                    "TeamIncidentCount": 0,
                    "TeamName": "Dean Marsh",
                    "UserID": 9700,
                    "UserName": "Dean Marsh"
                },
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 106.5963,
                    "CarClassID": 0,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 100,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "8,ffffff,ed1c24,231f20-ffffff",
                    "CarID": 195,
                    "CarIdx": 2,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "2",
                    "CarNumberDesignStr": "3,2,ed1c24,231f20,231f20",
                    "CarNumberRaw": 2,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "11,ffffff,ed1c24,231f20",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "30,ffffff,ed1c24,231f20",
                    "TeamID": 3,
                    "TeamIncidentCount": 0,
                    "TeamName": "Chad Knaus",
                    "UserID": 9701,
                    "UserName": "Chad Knaus"
                },
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 106.5963,
                    "CarClassID": 0,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 100,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "6,FF0000,00FF00,0000FF",
                    "CarID": 195,
                    "CarIdx": 3,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "3",
                    "CarNumberDesignStr": "0,0,,,",
                    "CarNumberRaw": 3,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "50,E22A1B,706f6f,FFFFFF",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "29,E22A1B,706f6f,FFFFFF",
                    "TeamID": 4,
                    "TeamIncidentCount": 0,
                    "TeamName": "Nathan Wright",
                    "UserID": 9702,
                    "UserName": "Nathan Wright"
                },
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 106.5963,
                    "CarClassID": 0,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 100,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "21,040707,1D1E1E,EC1E27",
                    "CarID": 195,
                    "CarIdx": 4,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "4",
                    "CarNumberDesignStr": "1,2,EC1E27,040707,040707",
                    "CarNumberRaw": 4,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 390,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "31,040707,1D1E1E,EC1E27",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "32,040707,1D1E1E,EC1E27",
                    "TeamID": 5,
                    "TeamIncidentCount": 0,
                    "TeamName": "Hieu Tran",
                    "UserID": 9703,
                    "UserName": "Hieu Tran"
                },
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 106.5963,
                    "CarClassID": 0,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 100,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "1,FF0000,00FF00,0000FF",
                    "CarID": 195,
                    "CarIdx": 5,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "323",
                    "CarNumberDesignStr": "55,4,0a0a0a,ffffff,ffffff",
                    "CarNumberRaw": 323,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "18,ffffff,3473bb,da4443",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "32,ffffff,3473bb,da4443",
                    "TeamID": 6,
                    "TeamIncidentCount": 0,
                    "TeamName": "Jonas Meyer",
                    "UserID": 9704,
                    "UserName": "Jonas Meyer"
                },
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 106.5963,
                    "CarClassID": 0,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 100,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "7,FF0000,00FF00,0000FF",
                    "CarID": 195,
                    "CarIdx": 6,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "95",
                    "CarNumberDesignStr": "0,0,,,",
                    "CarNumberRaw": 95,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "45,FFFF00,000000,EEEEEE",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "33,FFFF00,000000,EEEEEE",
                    "TeamID": 7,
                    "TeamIncidentCount": 0,
                    "TeamName": "Michael Leavine",
                    "UserID": 9705,
                    "UserName": "Michael Leavine"
                },
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 106.5963,
                    "CarClassID": 0,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 100,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "16,FFFFFF,00599B,B62115",
                    "CarID": 195,
                    "CarIdx": 7,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "7",
                    "CarNumberDesignStr": "0,0,,,",
                    "CarNumberRaw": 7,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "2,FFFFFF,00599B,B62115",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "14,FFFFFF,00599B,B62115",
                    "TeamID": 8,
                    "TeamIncidentCount": 0,
                    "TeamName": "Scottie Nash",
                    "UserID": 9706,
                    "UserName": "Scottie Nash"
                },
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 106.5963,
                    "CarClassID": 0,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 100,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "14,ffffff,2e358f,ec232d.ffffff",
                    "CarID": 195,
                    "CarIdx": 8,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "8",
                    "CarNumberDesignStr": "3,4,2e358f,0a0a0a,ffffff",
                    "CarNumberRaw": 8,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 7,
                    "CarSponsor_2": 7,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "62,ffffff,2e358f,ec232d",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "27,ffffff,2e358f,ec232d",
                    "TeamID": 9,
                    "TeamIncidentCount": 0,
                    "TeamName": "Dave Kaemmer",
                    "UserID": 9707,
                    "UserName": "Dave Kaemmer"
                },
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 106.5963,
                    "CarClassID": 0,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 100,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "1,FF0000,00FF00,0000FF",
                    "CarID": 195,
                    "CarIdx": 9,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "9",
                    "CarNumberDesignStr": "0,0,FFFFFF,283583,283583",
                    "CarNumberRaw": 9,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "68,283583,231F20,EF3F43",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "2,283583,231F20,EF3F43",
                    "TeamID": 10,
                    "TeamIncidentCount": 0,
                    "TeamName": "Baldur Karlsson",
                    "UserID": 9708,
                    "UserName": "Baldur Karlsson"
                },
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 106.5963,
                    "CarClassID": 0,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 100,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "2,FF0000,00FF00,0000FF",
                    "CarID": 195,
                    "CarIdx": 10,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "17",
                    "CarNumberDesignStr": "15,2,ffffff,0a0a0a,2e358f",
                    "CarNumberRaw": 17,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "2,FFA62B,FFDD4A,FFFFFF",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "2,FFDD4A,000000,FFDD4A",
                    "TeamID": 11,
                    "TeamIncidentCount": 0,
                    "TeamName": "Tom Brown",
                    "UserID": 9709,
                    "UserName": "Tom Brown"
                },
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 106.5963,
                    "CarClassID": 0,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 100,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "7,FF0000,00FF00,0000FF",
                    "CarID": 195,
                    "CarIdx": 11,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "11",
                    "CarNumberDesignStr": "0,0,,,",
                    "CarNumberRaw": 11,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "29,1C1C1C,6196D0,B82026",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "13,1C1C1C,6196D0,B82026",
                    "TeamID": 12,
                    "TeamIncidentCount": 0,
                    "TeamName": "David Lin",
                    "UserID": 9710,
                    "UserName": "David Lin"
                },
                {
                    "AbbrevName": null,
                    "BodyType": 0,
                    "CarCfg": -1,
                    "CarCfgCustomPaintExt": null,
                    "CarCfgName": null,
                    "CarClassColor": 16777215,
                    "CarClassDryTireSetLimit": "0 %",
                    "CarClassEstLapTime": 98.2356,
                    "CarClassID": 11,
                    "CarClassLicenseLevel": 0,
                    "CarClassMaxFuelPct": "1.000 %",
                    "CarClassPowerAdjust": "0.000 %",
                    "CarClassRelSpeed": 0,
                    "CarClassShortName": null,
                    "CarClassWeightPenalty": "0.000 kg",
                    "CarDesignStr": "0,ffffff,ffffff,ffffff",
                    "CarID": 136,
                    "CarIdx": 12,
                    "CarIsAI": 0,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 1,
                    "CarNumber": "0",
                    "CarNumberDesignStr": "0,0,ffffff,ffffff,ffffff",
                    "CarNumberRaw": 0,
                    "CarPath": "safety pcsedan",
                    "CarScreenName": "safety pcsedan",
                    "CarScreenNameShort": "safety pcsedan",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "0,ffffff,ffffff,ffffff",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 16777215,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "0,ffffff,ffffff,ffffff",
                    "TeamID": 0,
                    "TeamIncidentCount": 0,
                    "TeamName": "Pace Car",
                    "UserID": -1,
                    "UserName": "Pace Car"
                }
            ],
            "PaceCarIdx": 12
        },
        "QualifyResultsInfo": {
            "Results": null
        },
        "RadioInfo": {
            "Radios": [
                {
                    "Frequencies": [
                        {
                            "CanScan": 1,
                            "CanSquawk": 1,
                            "CarIdx": -1,
                            "ClubID": 0,
                            "EntryIdx": -1,
                            "FrequencyName": "@ALLTEAMS",
                            "FrequencyNum": 0,
                            "IsDeletable": 0,
                            "IsMutable": 1,
                            "Muted": 0,
                            "Priority": 12
                        },
                        {
                            "CanScan": 1,
                            "CanSquawk": 1,
                            "CarIdx": -1,
                            "ClubID": 0,
                            "EntryIdx": -1,
                            "FrequencyName": "@DRIVERS",
                            "FrequencyNum": 1,
                            "IsDeletable": 0,
                            "IsMutable": 1,
                            "Muted": 0,
                            "Priority": 15
                        },
                        {
                            "CanScan": 1,
                            "CanSquawk": 1,
                            "CarIdx": 0,
                            "ClubID": 0,
                            "EntryIdx": -1,
                            "FrequencyName": "@TEAM",
                            "FrequencyNum": 2,
                            "IsDeletable": 0,
                            "IsMutable": 0,
                            "Muted": 0,
                            "Priority": 60
                        },
                        {
                            "CanScan": 1,
                            "CanSquawk": 1,
                            "CarIdx": -1,
                            "ClubID": 0,
                            "EntryIdx": -1,
                            "FrequencyName": "@ADMIN",
                            "FrequencyNum": 3,
                            "IsDeletable": 0,
                            "IsMutable": 0,
                            "Muted": 0,
                            "Priority": 90
                        },
                        {
                            "CanScan": 1,
                            "CanSquawk": 1,
                            "CarIdx": -1,
                            "ClubID": 0,
                            "EntryIdx": -1,
                            "FrequencyName": "@RACECONTROL",
                            "FrequencyNum": 4,
                            "IsDeletable": 0,
                            "IsMutable": 0,
                            "Muted": 0,
                            "Priority": 80
                        },
                        {
                            "CanScan": 1,
                            "CanSquawk": 1,
                            "CarIdx": -1,
                            "ClubID": 0,
                            "EntryIdx": 0,
                            "FrequencyName": "@PRIVATE",
                            "FrequencyNum": 5,
                            "IsDeletable": 0,
                            "IsMutable": 0,
                            "Muted": 0,
                            "Priority": 70
                        }
                    ],
                    "HopCount": 2,
                    "NumFrequencies": 6,
                    "RadioNum": 0,
                    "ScanningIsOn": 1,
                    "TunedToFrequencyNum": 0
                }
            ],
            "SelectedRadioNum": 0
        },
        "SessionInfo": {
            "CurrentSessionNum": 0,
            "Sessions": [
                {
                    "ResultsAverageLapTime": -1,
                    "ResultsFastestLap": [
                        {
                            "CarIdx": 6,
                            "FastestLap": 2,
                            "FastestTime": 111.7599
                        }
                    ],
                    "ResultsLapsComplete": -1,
                    "ResultsNumCautionFlags": 0,
                    "ResultsNumCautionLaps": 0,
                    "ResultsNumLeadChanges": 0,
                    "ResultsOfficial": 0,
                    "ResultsPositions": [
                        {
                            "CarIdx": 6,
                            "ClassPosition": 0,
                            "FastestLap": 2,
                            "FastestTime": 111.7599,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 2,
                            "LapsComplete": 40,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 113.187,
                            "Position": 1,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 111.7599
                        },
                        {
                            "CarIdx": 9,
                            "ClassPosition": 1,
                            "FastestLap": 31,
                            "FastestTime": 111.9697,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 31,
                            "LapsComplete": 38,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 114.3515,
                            "Position": 2,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 111.9697
                        },
                        {
                            "CarIdx": 8,
                            "ClassPosition": 2,
                            "FastestLap": 30,
                            "FastestTime": 112.0831,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 30,
                            "LapsComplete": 41,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 112.0864,
                            "Position": 3,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.0831
                        },
                        {
                            "CarIdx": 10,
                            "ClassPosition": 3,
                            "FastestLap": 10,
                            "FastestTime": 112.1554,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 10,
                            "LapsComplete": 41,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 112.8478,
                            "Position": 4,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.1554
                        },
                        {
                            "CarIdx": 1,
                            "ClassPosition": 4,
                            "FastestLap": 21,
                            "FastestTime": 112.2629,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 21,
                            "LapsComplete": 42,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 113.6847,
                            "Position": 5,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.2629
                        },
                        {
                            "CarIdx": 4,
                            "ClassPosition": 5,
                            "FastestLap": 23,
                            "FastestTime": 112.2856,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 23,
                            "LapsComplete": 42,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 113.6535,
                            "Position": 6,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.2856
                        },
                        {
                            "CarIdx": 11,
                            "ClassPosition": 6,
                            "FastestLap": 8,
                            "FastestTime": 112.4416,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 8,
                            "LapsComplete": 44,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 114.663,
                            "Position": 7,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.4416
                        },
                        {
                            "CarIdx": 7,
                            "ClassPosition": 7,
                            "FastestLap": 24,
                            "FastestTime": 112.4423,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 24,
                            "LapsComplete": 40,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 113.4492,
                            "Position": 8,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.4423
                        },
                        {
                            "CarIdx": 5,
                            "ClassPosition": 8,
                            "FastestLap": 3,
                            "FastestTime": 112.4429,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 3,
                            "LapsComplete": 40,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 114.1149,
                            "Position": 9,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.4429
                        },
                        {
                            "CarIdx": 2,
                            "ClassPosition": 9,
                            "FastestLap": 25,
                            "FastestTime": 112.6487,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 25,
                            "LapsComplete": 41,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 113.5557,
                            "Position": 10,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.6487
                        },
                        {
                            "CarIdx": 3,
                            "ClassPosition": 10,
                            "FastestLap": 37,
                            "FastestTime": 112.8944,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 37,
                            "LapsComplete": 44,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 114.8362,
                            "Position": 11,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.8944
                        }
                    ],
                    "SessionEnforceTireCompoundChange": 0,
                    "SessionLaps": "unlimited",
                    "SessionName": "PRACTICE",
                    "SessionNum": 0,
                    "SessionNumLapsToAvg": 0,
                    "SessionRunGroupsUsed": 0,
                    "SessionSkipped": 0,
                    "SessionSubType": null,
                    "SessionTime": "10980.0000 sec",
                    "SessionTrackRubberState": "slight usage",
                    "SessionType": "Practice"
                },
                {
                    "ResultsAverageLapTime": -1,
                    "ResultsFastestLap": [
                        {
                            "CarIdx": 255,
                            "FastestLap": 0,
                            "FastestTime": -1
                        }
                    ],
                    "ResultsLapsComplete": -1,
                    "ResultsNumCautionFlags": 0,
                    "ResultsNumCautionLaps": 0,
                    "ResultsNumLeadChanges": 0,
                    "ResultsOfficial": 0,
                    "ResultsPositions": null,
                    "SessionEnforceTireCompoundChange": 0,
                    "SessionLaps": 2,
                    "SessionName": "QUALIFY",
                    "SessionNum": 1,
                    "SessionNumLapsToAvg": 0,
                    "SessionRunGroupsUsed": 0,
                    "SessionSkipped": 0,
                    "SessionSubType": null,
                    "SessionTime": "86400.0000 sec",
                    "SessionTrackRubberState": "carry over",
                    "SessionType": "Lone Qualify"
                },
                {
                    "ResultsAverageLapTime": -1,
                    "ResultsFastestLap": [
                        {
                            "CarIdx": 255,
                            "FastestLap": 0,
                            "FastestTime": -1
                        }
                    ],
                    "ResultsLapsComplete": -1,
                    "ResultsNumCautionFlags": 0,
                    "ResultsNumCautionLaps": 0,
                    "ResultsNumLeadChanges": 0,
                    "ResultsOfficial": 0,
                    "ResultsPositions": null,
                    "SessionEnforceTireCompoundChange": 0,
                    "SessionLaps": "unlimited",
                    "SessionName": "RACE",
                    "SessionNum": 2,
                    "SessionNumLapsToAvg": 0,
                    "SessionRunGroupsUsed": 0,
                    "SessionSkipped": 0,
                    "SessionSubType": null,
                    "SessionTime": "720.0000 sec",
                    "SessionTrackRubberState": "carry over",
                    "SessionType": "Race"
                }
            ]
        },
        "SplitTimeInfo": {
            "Sectors": [
                {
                    "SectorNum": 0,
                    "SectorStartPct": 0
                },
                {
                    "SectorNum": 1,
                    "SectorStartPct": 0.269865
                },
                {
                    "SectorNum": 2,
                    "SectorStartPct": 0.568338
                },
                {
                    "SectorNum": 3,
                    "SectorStartPct": 0.735294
                }
            ]
        },
        "WeekendInfo": {
            "AIRosterName": "Generated Roster - BMW M2 Cup by Nitro Concepts",
            "BuildTarget": "Members",
            "BuildType": "Release",
            "BuildVersion": "2025.12.16.02",
            "Category": "SportsCar",
            "DCRuleSet": "None",
            "EventType": "Race",
            "HeatRacing": 0,
            "LeagueID": 0,
            "MaxDrivers": 0,
            "MinDrivers": 0,
            "NumCarClasses": 1,
            "NumCarTypes": 2,
            "Official": 0,
            "QualifierMustStartRace": 0,
            "RaceFarm": null,
            "RaceWeek": 0,
            "SeasonID": 0,
            "SeriesID": 0,
            "SessionID": 0,
            "SimMode": "full",
            "SubSessionID": 0,
            "TeamRacing": 0,
            "TelemetryOptions": {
                "TelemetryDiskFile": "D /DevHome/Documents/iRacing/telemetry/bmwm2csr_navarra speedlong 2026-01-01 13-52-51.ibt"
            },
            "TrackAirDensity": "1.15 kg/m^3",
            "TrackAirPressure": "28.67 Hg",
            "TrackAirTemp": "18.76 C",
            "TrackAltitude": "421.00 m",
            "TrackCity": "Los Arcos",
            "TrackCleanup": 0,
            "TrackConfigName": "Speed Circuit Long",
            "TrackCountry": "Spain",
            "TrackDirection": "neutral",
            "TrackDisplayName": "Circuito de Navarra",
            "TrackDisplayShortName": "Navarra",
            "TrackDynamicTrack": 1,
            "TrackFogLevel": "0 %",
            "TrackID": 515,
            "TrackLatitude": "42.559233 m",
            "TrackLength": "3.8874 km",
            "TrackLengthOfficial": "3.93 km",
            "TrackLongitude": "-2.168089 m",
            "TrackName": "navarra speedlong",
            "TrackNorthOffset": "2.7562 rad",
            "TrackNumPitStalls": 16,
            "TrackNumTurns": 15,
            "TrackPaceSpeed": "22.35 kph",
            "TrackPitSpeedLimit": "60.00 kph",
            "TrackPrecipitation": "0 %",
            "TrackRelativeHumidity": "75 %",
            "TrackSkies": "Dynamic",
            "TrackState": "Navarre",
            "TrackSurfaceTemp": "33.01 C",
            "TrackSurfaceTempCrew": "20.56 C",
            "TrackType": "road course",
            "TrackVersion": "2025.12.01.02",
            "TrackWeatherType": "Realistic",
            "TrackWindDir": "4.18 rad",
            "TrackWindVel": "4.87 m/s",
            "WeekendOptions": {
                "CommercialMode": "consumer",
                "CourseCautions": "local",
                "Date": "2026-01-03T00:00:00Z",
                "EarthRotationSpeedupFactor": 1,
                "FastRepairsLimit": 1,
                "FogLevel": "0 %",
                "GreenWhiteCheckeredLimit": 0,
                "HardcoreLevel": 1,
                "HasOpenRegistration": 0,
                "IncidentLimit": 17,
                "IsFixedSetup": 0,
                "NightMode": "variable",
                "NumJokerLaps": 0,
                "NumStarters": 12,
                "QualifyScoring": "best lap",
                "RelativeHumidity": "45 %",
                "Restarts": "double file lapped cars behind",
                "ShortParadeLap": 0,
                "Skies": "Dynamic",
                "StandingStart": 1,
                "StartingGrid": "single file",
                "StrictLapsChecking": "default",
                "TimeOfDay": "1:50 pm",
                "Unofficial": 1,
                "WeatherTemp": "25.56 C",
                "WeatherType": "Realistic",
                "WindDirection": "N",
                "WindSpeed": "3.22 km/h"
            }
        }
    },
    "_ts": 1767306139
}
```

## Race Center Settings

```json
{
  "id": "default-center",
  "centerId": "default-center",
  "name": "Sim RaceCenter HQ",
  "rigs": [
    {
      "id": "7f159a00-2ba7-43ff-b4c6-4565e89336f9",
      "rigId": "db066d96-1c99-4fe0-b13a-807a2b1d7da0",
      "name": "Rig 1",
      "machineId": "Rig1",
      "notes": ""
    },
    {
      "id": "450f4cbb-3215-4372-819c-0aa46a2c1489",
      "rigId": "bf44b8c6-3cae-4671-82a4-b26e09f3fcde",
      "name": "Rig 2",
      "machineId": "Rig2",
      "notes": ""
    }
  ],
  "obsScenes": [
    {
      "id": "1b30ee83-51da-495b-a570-1dc15b0adce8",
      "obsSceneId": "e086f376-9ce0-455a-9d38-c174a43d4b27",
      "name": "Rig 1 Driver Solo",
      "displayName": "Rig 1 Driver Solo",
      "profile": "",
      "sceneCollection": ""
    },
    {
      "id": "d3564884-27d5-48ae-973d-08dd77e80664",
      "obsSceneId": "6075c730-fa19-488c-8fb1-b107214c7f97",
      "name": "Rig 2 Driver Dual",
      "displayName": "Rig 2 Driver Dual",
      "profile": "",
      "sceneCollection": ""
    },
    {
      "id": "f8a4dc01-07d0-47fe-82b5-e9f116d023ed",
      "obsSceneId": "7c33dcba-5b35-4853-82dc-47ba441d703e",
      "name": "Rig 1 Driver Dual",
      "displayName": "Rig 1 Driver Dual",
      "profile": "",
      "sceneCollection": ""
    },
    {
      "id": "1f3763c3-bf7a-4b4e-a0cc-fd075aa4f740",
      "obsSceneId": "3763277e-b7cb-4715-bb2f-9f77f8cc605b",
      "name": "Director Solo",
      "displayName": "Director Solo",
      "profile": "",
      "sceneCollection": ""
    },
    {
      "id": "7bd8ce54-5783-4600-99e1-541b4d1dd437",
      "obsSceneId": "fdcec54a-48a1-4edb-a8b6-6be8dba2e213",
      "name": "Director Dual",
      "displayName": "Director Dual",
      "profile": "",
      "sceneCollection": ""
    }
  ],
  "createdAt": "2025-11-29T18:11:28.524Z",
  "updatedAt": "2025-12-19T16:35:26.447Z",
  "_rid": "KBMqAKxEig8BAAAAAAAAAA==",
  "_self": "dbs/KBMqAA==/colls/KBMqAKxEig8=/docs/KBMqAKxEig8BAAAAAAAAAA==/",
  "_etag": "\"dd003c9a-0000-4d00-0000-69457ece0000\"",
  "_attachments": "attachments/",
  "cameraSettings": {
    "forward": [
      {
        "cameraGroupName": "Roll Bar",
        "cameraDirection": "Forward",
        "groupWeight": 0.7,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "Cockpit",
        "cameraDirection": "Forward",
        "groupWeight": 0.4,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "LR Susp",
        "cameraDirection": "Behind",
        "groupWeight": 0.2,
        "cameraTargetCar": "Ahead"
      },
      {
        "cameraGroupName": "RR Susp",
        "cameraDirection": "Behind",
        "groupWeight": 0,
        "cameraTargetCar": "Ahead"
      },
      {
        "cameraGroupName": "LF Susp",
        "cameraDirection": "Forward",
        "groupWeight": 0,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "RF Susp",
        "cameraDirection": "Forward",
        "groupWeight": 0.2,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "TV1",
        "cameraDirection": "TV",
        "groupWeight": 0.1,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "Gearbox",
        "cameraDirection": "Behind",
        "groupWeight": 0.1,
        "cameraTargetCar": "Ahead"
      },
      {
        "cameraGroupName": "Nose",
        "cameraDirection": "Forward",
        "groupWeight": 0,
        "cameraTargetCar": "Player"
      }
    ],
    "rear": [
      {
        "cameraGroupName": "Roll Bar",
        "cameraDirection": "Forward",
        "groupWeight": 0.7,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "Cockpit",
        "cameraDirection": "Forward",
        "groupWeight": 0.4,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "Roll Bar",
        "cameraDirection": "Forward",
        "groupWeight": 0.5,
        "cameraTargetCar": "Behind"
      },
      {
        "cameraGroupName": "Cockpit",
        "cameraDirection": "Forward",
        "groupWeight": 0.1,
        "cameraTargetCar": "Behind"
      },
      {
        "cameraGroupName": "LR Susp",
        "cameraDirection": "Behind",
        "groupWeight": 0.1,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "RR Susp",
        "cameraDirection": "Behind",
        "groupWeight": 0,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "LF Susp",
        "cameraDirection": "Forward",
        "groupWeight": 0,
        "cameraTargetCar": "Behind"
      },
      {
        "cameraGroupName": "RF Susp",
        "cameraDirection": "Forward",
        "groupWeight": 0.1,
        "cameraTargetCar": "Behind"
      },
      {
        "cameraGroupName": "TV1",
        "cameraDirection": "TV",
        "groupWeight": 0.1,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "Gearbox",
        "cameraDirection": "Behind",
        "groupWeight": 0,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "Nose",
        "cameraDirection": "Forward",
        "groupWeight": 0.1,
        "cameraTargetCar": "Behind"
      }
    ],
    "general": [
      {
        "cameraGroupName": "Roll Bar",
        "cameraDirection": "Forward",
        "groupWeight": 0.6,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "Cockpit",
        "cameraDirection": "Forward",
        "groupWeight": 0.4,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "TV Mixed",
        "cameraDirection": "TV",
        "groupWeight": 0.3,
        "cameraTargetCar": "Player"
      },
      {
        "cameraGroupName": "TV1",
        "cameraDirection": "TV",
        "groupWeight": 0.2,
        "cameraTargetCar": "Player"
      }
    ]
  },
  "_ts": 1766162126
}
```
