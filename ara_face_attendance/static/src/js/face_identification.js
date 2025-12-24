/* @odoo-module */

import kiosk from "@hr_attendance/public_kiosk/public_kiosk_app"
import { patch } from "@web/core/utils/patch"
import { useService } from "@web/core/utils/hooks"
import { useRef, useState } from "@odoo/owl"
import { _t } from "@web/core/l10n/translation"
import { rpc } from "@web/core/network/rpc"
const MODEL_URL = "/ara_base_identify_face/static/face-api/weights"
faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL)
faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
faceapi.nets.tinyFaceDetector.load(MODEL_URL),
    faceapi.nets.faceLandmark68TinyNet.load(MODEL_URL),
    faceapi.nets.faceExpressionNet.load(MODEL_URL),
    faceapi.nets.ageGenderNet.load(MODEL_URL)

patch(kiosk.kioskAttendanceApp.prototype, {
    setup() {
        super.setup(...arguments)

        this.rpcService = rpc
        this.ormService = useService("orm")
        this.faceImageRef = useRef("face_image_ref")
        this.cameraRef = useRef("camera_ref")
        this.notify = useService("notification")

        this.state.isIdentified = false
        this.state.matchedEmployeeId = null

        this._cameraActive = false
        this._videoStream = null
        this._matcher = null
        this._failedAttempts = 0
    },
    async _loadDescriptors() {
        const imgEl = this.faceImageRef.el
        return await faceapi
            .detectSingleFace(imgEl)
            .withFaceLandmarks()
            .withFaceExpressions()
            .withFaceDescriptor()
    },
    async _fetchEmployeeImage(empId) {
        const result = await this.rpcService("/get_employee_image", {
            employee_id: empId,
        })
        this._imageExists = result

        const imgEl = this.faceImageRef.el
        imgEl.src = "data:image/jpeg;base64," + result

        this._currentEmployeeId = empId
    },
    async _startFaceScan(videoEl) {
        if (!this._cameraActive) return

        if (!this._matcher) {
            const descriptorResult = await this._loadDescriptors()
            if (descriptorResult && descriptorResult.descriptor) {
                this._matcher = new faceapi.FaceMatcher([
                    descriptorResult.descriptor,
                ])
            } else {
                this.notify.add(
                    _t(
                        "Failed to initialize face recognition. Upload a valid photo."
                    ),
                    {
                        type: "danger",
                        title: "Recognition Setup Failed",
                    }
                )
                this._stopFaceScan(videoEl)
                return
            }
        }

        const canvas = faceapi.createCanvasFromMedia(videoEl)
        document.body.appendChild(canvas)
        canvas.style.display = "none"

        const displaySize = {
            width: videoEl.videoWidth,
            height: videoEl.videoHeight,
        }
        faceapi.matchDimensions(canvas, displaySize)

        const scanFrame = async () => {
            if (!this._cameraActive) return

            try {
                const detections = await faceapi
                    .detectAllFaces(videoEl)
                    .withFaceLandmarks()
                    .withFaceExpressions()
                    .withFaceDescriptors()

                if (!detections.length) {
                    if (this._cameraActive) requestAnimationFrame(scanFrame)
                    return
                }

                for (const detection of detections) {
                    const bestMatch = this._matcher.findBestMatch(
                        detection.descriptor
                    )
                    if (bestMatch._distance < 0.4) {
                        this.state.isIdentified = true
                        this.state.matchedEmployeeId = this._currentEmployeeId
                        this._stopFaceScan(videoEl, canvas)
                        return
                    } else {
                        this._failedAttempts++
                        if (this._failedAttempts >= 3) {
                            this.notify.add(_t("Face Mismatch !"), {
                                title: "Identification Failed",
                                type: "danger",
                            })
                            this._stopFaceScan(videoEl, canvas)
                            return
                        }
                    }
                }

                if (this._cameraActive) requestAnimationFrame(scanFrame)
            } catch (error) {
                console.error("Face recognition failed:", error)
                this._stopFaceScan(videoEl, canvas)
            }
        }

        scanFrame()
    },
    _stopFaceScan(videoEl, canvasEl = null) {
        this._cameraActive = false

        if (this._videoStream) {
            this._videoStream.getTracks().forEach(track => track.stop())
            this._videoStream = null
        }

        if (videoEl) {
            videoEl.srcObject = null
            videoEl.style.display = "none"
        }

        if (canvasEl && canvasEl.parentNode) {
            canvasEl.remove()
        }

        const modal = document.getElementById("WebCamModal")
        if (modal) {
            modal.style.display = "none"
        }

        this._matcher = null
        this._failedAttempts = 0
    },
    async _enableCamera() {
        const videoEl = this.cameraRef.el
        if (videoEl) {
            videoEl.srcObject = null
            videoEl.style.display = "block"
        }

        this._cameraActive = true
        this.state.isIdentified = false
        this._matcher = null
        this._failedAttempts = 0

        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
            })
            this._videoStream = mediaStream
            videoEl.srcObject = mediaStream

            await new Promise(resolve => {
                videoEl.onloadedmetadata = resolve
            })

            await this._startFaceScan(videoEl)
        } catch (err) {
            console.error("Webcam error:", err)
            this._cameraActive = false
            this.notify.add(_t("Browser not support camera access."), {
                title: "Camera Access Denied",
                type: "danger",
            })
        }
    },

    async onManualSelection(employeeId, pinCode) {
        if (this._cameraActive) {
            this._stopFaceScan(this.cameraRef.el)
        }

        await this._fetchEmployeeImage(employeeId)

        if (this._imageExists) {
            const modal = document.getElementById("WebCamModal")
            if (modal) modal.style.display = "block"

            await this._enableCamera()

            const polling = setInterval(() => {
                if (
                    this.state.isIdentified &&
                    this.state.matchedEmployeeId === employeeId
                ) {
                    clearInterval(polling)
                    this.rpcService("manual_selection", {
                        token: this.props.token,
                        employee_id: employeeId,
                        pin_code: pinCode,
                    }).then(result => {
                        if (result && result.attendance) {
                            this.employeeData = result
                            this.switchDisplay("greet")
                        } else {
                            if (pinCode) {
                                this.notify.add(_t("Incorrect PIN code."), {
                                    type: "danger",
                                })
                            }
                        }
                    })
                }
            }, 500)
        } else {
            await this.popup.add(ErrorPopup, {
                title: _t("Authentication Failed"),
                body: _t("No image found for the selected employee."),
            })
            location.reload()
        }
    },
})
