{
    "name": "Face Identification Attendance",
    "version": "18.0.0.0.0",
    "category": "Tools",
    "summary": """Face Identification login Attendance""",
    "author": "ARA SOFT",
    "depends": ["ara_base_identify_face", "hr_attendance"],
    "assets": {
        "web.assets_backend": [
            "ara_base_identify_face/static/face-api/face-api.js",
        ],
        "hr_attendance.assets_public_attendance": [
            "ara_base_identify_face/static/face-api/face-api.js",
            "ara_face_attendance/static/src/xml/face_identification.xml",
            "ara_face_attendance/static/src/js/face_identification.js",
        ],
    },
    "license": "OPL-1",
    "installable": True,
    "auto_install": False,
    "application": False,
    "price": 58.22,
    "currency": "USD",
    "images": ['static/description/banner.gif'],
}
