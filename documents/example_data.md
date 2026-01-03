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
    "id": "e97e09e7-8899-47e5-8549-7291bf4c2543",
    "raceSessionId": "e97e09e7-8899-47e5-8549-7291bf4c2543",
    "name": "OBS Test",
    "simulator": "iRacing",
    "directorSceneId": "3763277e-b7cb-4715-bb2f-9f77f8cc605b",
    "drivers": [
        {
            "id": "ba1d5d6c-bd83-4982-96bd-7273080392bd",
            "raceSessionDriverId": "393f3fa1-972c-4bcb-abe0-4c83ce1fb25d",
            "raceSessionId": "e97e09e7-8899-47e5-8549-7291bf4c2543",
            "driverId": "69ab10bc-ec63-424c-b625-9ba20c6e2c4b",
            "rigId": "db066d96-1c99-4fe0-b13a-807a2b1d7da0",
            "obsSceneId": "e086f376-9ce0-455a-9d38-c174a43d4b27",
            "carNumber": ""
        }
    ],
    "scheduledStart": "2026-01-02T15:50:54.659Z",
    "createdAt": "2026-01-02T15:50:54.659Z",
    "updatedAt": "2026-01-02T15:50:54.659Z",
    "createdBy": "e24e1f95-ef67-433d-8e1c-9fca1ae3be44",
    "createdByUserId": "e24e1f95-ef67-433d-8e1c-9fca1ae3be44",
    "centerId": "default-center",
    "_rid": "KBMqAJBEj4weAAAAAAAAAA==",
    "_self": "dbs/KBMqAA==/colls/KBMqAJBEj4w=/docs/KBMqAJBEj4weAAAAAAAAAA==/",
    "_etag": "\"02005c4a-0000-4d00-0000-695801cd0000\"",
    "_attachments": "attachments/",
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
            "UpdateCount": 3
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
                    "CarDesignStr": "2,FF0000,00FF00,0000FF",
                    "CarID": 195,
                    "CarIdx": 1,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "301",
                    "CarNumberDesignStr": "0,0,,,",
                    "CarNumberRaw": 301,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "22,03a53e,fd7704,ffffff",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "14,03a53e,fd7704,ffffff",
                    "TeamID": 2,
                    "TeamIncidentCount": 0,
                    "TeamName": "Randy Cassidy",
                    "UserID": 9700,
                    "UserName": "Randy Cassidy"
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
                    "CarDesignStr": "11,ffffff,38a4fe,ffe700",
                    "CarID": 195,
                    "CarIdx": 2,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "71",
                    "CarNumberDesignStr": "46,0,171717,ffffff,38a4fe",
                    "CarNumberRaw": 71,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 282,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "37,ffffff,38a4fe,ffe700",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "9,ffffff,38a4fe,ffe700",
                    "TeamID": 3,
                    "TeamIncidentCount": 0,
                    "TeamName": "Sean Ambrose",
                    "UserID": 9701,
                    "UserName": "Sean Ambrose"
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
                    "CarDesignStr": "8,0046AD,ED2129,FFFFFF",
                    "CarID": 195,
                    "CarIdx": 3,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "940",
                    "CarNumberDesignStr": "15,2,ffffff,0a0a0a,2e358f",
                    "CarNumberRaw": 940,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 2,
                    "CarSponsor_2": 130,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "26,0078B5,52C5FF,FFFFFF",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "33,FFFFFF,0046AD,ED2129",
                    "TeamID": 4,
                    "TeamIncidentCount": 0,
                    "TeamName": "Yuzhi Steven Zhu",
                    "UserID": 9702,
                    "UserName": "Yuzhi Steven Zhu"
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
                    "HelmetDesignStr": "68,040707,1D1E1E,EC1E27",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "7,040707,1D1E1E,EC1E27",
                    "TeamID": 5,
                    "TeamIncidentCount": 0,
                    "TeamName": "Chris Lerch",
                    "UserID": 9703,
                    "UserName": "Chris Lerch"
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
                    "CarDesignStr": "15,FFFFFF,005AAA,ED1C24",
                    "CarID": 195,
                    "CarIdx": 5,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "5",
                    "CarNumberDesignStr": "41,0,221E1F,FFFFFF,ED1C24",
                    "CarNumberRaw": 5,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 323,
                    "CarSponsor_2": 323,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "28,FFFFFF,005AAA,ED1C24",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "34,FFFFFF,005AAA,ED1C24",
                    "TeamID": 6,
                    "TeamIncidentCount": 0,
                    "TeamName": "Kevin Iannarelli",
                    "UserID": 9704,
                    "UserName": "Kevin Iannarelli"
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
                    "CarIdx": 6,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "6",
                    "CarNumberDesignStr": "0,0,,,",
                    "CarNumberRaw": 6,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "25,2B2A29,003D72,E22A1B",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "20,2B2A29,003D72,E22A1B",
                    "TeamID": 7,
                    "TeamIncidentCount": 0,
                    "TeamName": "David Carrillo",
                    "UserID": 9705,
                    "UserName": "David Carrillo"
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
                    "CarDesignStr": "23,ffffff,3473bb,da4443",
                    "CarID": 195,
                    "CarIdx": 7,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "7",
                    "CarNumberDesignStr": "55,4,0a0a0a,ffffff,ffffff",
                    "CarNumberRaw": 7,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 195,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "52,ffffff,3473bb,da4443",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "28,ffffff,3473bb,da4443",
                    "TeamID": 8,
                    "TeamIncidentCount": 0,
                    "TeamName": "Jay Scullin",
                    "UserID": 9706,
                    "UserName": "Jay Scullin"
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
                    "CarDesignStr": "20,ffffff,2e358f,ec232d",
                    "CarID": 195,
                    "CarIdx": 8,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "07",
                    "CarNumberDesignStr": "3,4,2e358f,0a0a0a,ffffff",
                    "CarNumberRaw": 2007,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 7,
                    "CarSponsor_2": 7,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "27,ffffff,2e358f,ec232d",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "18,ffffff,2e358f,ec232d",
                    "TeamID": 9,
                    "TeamIncidentCount": 0,
                    "TeamName": "Nim Cross",
                    "UserID": 9707,
                    "UserName": "Nim Cross"
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
                    "CarDesignStr": "19,FFFFFF,EBECF8,283583",
                    "CarID": 195,
                    "CarIdx": 9,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "9",
                    "CarNumberDesignStr": "0,0,231F20,FFFFFF,FFFFFF",
                    "CarNumberRaw": 9,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 301,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "64,FFFFFF,EBECF8,283583",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "3,FFFFFF,EBECF8,283583",
                    "TeamID": 10,
                    "TeamIncidentCount": 0,
                    "TeamName": "Christopher Bell",
                    "UserID": 9708,
                    "UserName": "Christopher Bell"
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
                    "CarDesignStr": "16,25014E,3DF2FF,FF01EF",
                    "CarID": 195,
                    "CarIdx": 10,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "42",
                    "CarNumberDesignStr": "0,0,FFFFFF,283583,283583",
                    "CarNumberRaw": 42,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 0,
                    "CarSponsor_2": 0,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "68,25014E,3DF2FF,FF01EF",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "22,25014E,3DF2FF,FF01EF",
                    "TeamID": 11,
                    "TeamIncidentCount": 0,
                    "TeamName": "Josh Garner",
                    "UserID": 9709,
                    "UserName": "Josh Garner"
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
                    "CarDesignStr": "11,343538,38a4fe,fc2c37",
                    "CarID": 195,
                    "CarIdx": 11,
                    "CarIsAI": 1,
                    "CarIsElectric": 0,
                    "CarIsPaceCar": 0,
                    "CarNumber": "11",
                    "CarNumberDesignStr": "46,0,ffffff,343538,38a4fe",
                    "CarNumberRaw": 11,
                    "CarPath": "bmwm2csr",
                    "CarScreenName": "BMW M2 CS Racing",
                    "CarScreenNameShort": "BMW M2 CS Racing",
                    "CarSponsor_1": 254,
                    "CarSponsor_2": 283,
                    "CurDriverIncidentCount": 0,
                    "FaceType": 0,
                    "HelmetDesignStr": "68,343538,38a4fe,fc2c37",
                    "HelmetType": 0,
                    "IRating": 0,
                    "Initials": null,
                    "IsSpectator": 0,
                    "LicColor": 8913056,
                    "LicLevel": 1,
                    "LicString": "R 0.00",
                    "LicSubLevel": 0,
                    "SuitDesignStr": "33,343538,38a4fe,fc2c37",
                    "TeamID": 12,
                    "TeamIncidentCount": 0,
                    "TeamName": "Mike Gladfelter",
                    "UserID": 9710,
                    "UserName": "Mike Gladfelter"
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
                            "CarIdx": 8,
                            "FastestLap": 18,
                            "FastestTime": 111.289
                        }
                    ],
                    "ResultsLapsComplete": -1,
                    "ResultsNumCautionFlags": 0,
                    "ResultsNumCautionLaps": 0,
                    "ResultsNumLeadChanges": 0,
                    "ResultsOfficial": 0,
                    "ResultsPositions": [
                        {
                            "CarIdx": 8,
                            "ClassPosition": 0,
                            "FastestLap": 18,
                            "FastestTime": 111.289,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 18,
                            "LapsComplete": 24,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 112.1833,
                            "Position": 1,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 111.289
                        },
                        {
                            "CarIdx": 10,
                            "ClassPosition": 1,
                            "FastestLap": 23,
                            "FastestTime": 111.8883,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 23,
                            "LapsComplete": 27,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 112.4262,
                            "Position": 2,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 111.8883
                        },
                        {
                            "CarIdx": 5,
                            "ClassPosition": 2,
                            "FastestLap": 20,
                            "FastestTime": 112.012,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 20,
                            "LapsComplete": 26,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 114.0667,
                            "Position": 3,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.012
                        },
                        {
                            "CarIdx": 6,
                            "ClassPosition": 3,
                            "FastestLap": 20,
                            "FastestTime": 112.156,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 20,
                            "LapsComplete": 30,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 169.4123,
                            "Position": 4,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.156
                        },
                        {
                            "CarIdx": 4,
                            "ClassPosition": 4,
                            "FastestLap": 24,
                            "FastestTime": 112.214,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 24,
                            "LapsComplete": 30,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 113.4999,
                            "Position": 5,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.214
                        },
                        {
                            "CarIdx": 3,
                            "ClassPosition": 5,
                            "FastestLap": 11,
                            "FastestTime": 112.2846,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 11,
                            "LapsComplete": 29,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 112.5683,
                            "Position": 6,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.2846
                        },
                        {
                            "CarIdx": 9,
                            "ClassPosition": 6,
                            "FastestLap": 23,
                            "FastestTime": 112.4003,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 23,
                            "LapsComplete": 29,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 113.3108,
                            "Position": 7,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.4003
                        },
                        {
                            "CarIdx": 7,
                            "ClassPosition": 7,
                            "FastestLap": 26,
                            "FastestTime": 112.4005,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 26,
                            "LapsComplete": 29,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 113.5073,
                            "Position": 8,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.4005
                        },
                        {
                            "CarIdx": 1,
                            "ClassPosition": 8,
                            "FastestLap": 15,
                            "FastestTime": 112.476,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 15,
                            "LapsComplete": 28,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 113.4122,
                            "Position": 9,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 112.476
                        },
                        {
                            "CarIdx": 2,
                            "ClassPosition": 9,
                            "FastestLap": 11,
                            "FastestTime": 113.1588,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 11,
                            "LapsComplete": 29,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 114.3802,
                            "Position": 10,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 113.1588
                        },
                        {
                            "CarIdx": 11,
                            "ClassPosition": 10,
                            "FastestLap": 13,
                            "FastestTime": 113.631,
                            "Incidents": 0,
                            "JokerLapsComplete": 0,
                            "Lap": 13,
                            "LapsComplete": 28,
                            "LapsDriven": 0,
                            "LapsLed": 0,
                            "LastTime": 121.1326,
                            "Position": 11,
                            "ReasonOutId": 0,
                            "ReasonOutStr": "Running",
                            "Time": 113.631
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
                    "SessionTrackRubberState": "clean",
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
                "TelemetryDiskFile": "D /DevHome/Documents/iRacing/telemetry/bmwm2csr_navarra speedlong 2026-01-02 10-13-32.ibt"
            },
            "TrackAirDensity": "1.15 kg/m^3",
            "TrackAirPressure": "28.68 Hg",
            "TrackAirTemp": "18.61 C",
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
            "TrackRelativeHumidity": "84 %",
            "TrackSkies": "Dynamic",
            "TrackState": "Navarre",
            "TrackSurfaceTemp": "32.86 C",
            "TrackSurfaceTempCrew": "20.56 C",
            "TrackType": "road course",
            "TrackVersion": "2025.12.01.02",
            "TrackWeatherType": "Realistic",
            "TrackWindDir": "5.13 rad",
            "TrackWindVel": "3.84 m/s",
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
    "_ts": 1767375309
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
