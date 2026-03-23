/* @odoo-module */

import kiosk from "@hr_attendance/public_kiosk/public_kiosk_app";
import { patch } from "@web/core/utils/patch";
import { useService } from "@web/core/utils/hooks";
import { useRef, useState } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";
import { rpc } from "@web/core/network/rpc";

const MODEL_URL = '/ara_base_identify_face/static/face-api/weights';

// Load Face API models
if (typeof faceapi !== 'undefined') {
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
    faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
    faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL);
}

patch(kiosk.kioskAttendanceApp.prototype, {
    setup() {
        super.setup(...arguments);
        
        this.rpcService = rpc;
        this.notify = useService("notification");
        this.faceImageRef = useRef("face_image_ref");
        this.cameraRef = useRef("camera_ref");
        
        // Initialize state
        this.state.isIdentified = false;
        this.state.matchedEmployeeId = null;
        this.state.showCameraModal = false;
        this.state.isScanning = false;
        this.state.scanningStatus = "ready";
        this.state.employeeAttendanceStatus = null;
        this.state.selectedAction = null;
        this.state.currentEmployeeId = null;
        this.state.errorMessage = "";
        this.state.errorTitle = "";
        this.state.errorDetails = "";
        
        // Internal variables
        this._cameraActive = false;
        this._videoStream = null;
        this._matcher = null;
        this._failedAttempts = 0;
        this._pendingEmployeeId = null;
        this._pendingPinCode = null;
        this._pendingAction = null;
        this._scanInterval = null;
        this._imageExists = false;
        this._currentEmployeeId = null;
    },

    async willStart() {
        await super.willStart(...arguments);
        await this._getEmployeeAttendanceStatus();
    },

    // ==================== DISPLAY & NAVIGATION ====================
    switchDisplay(display) {
        console.log("Switching display to:", display, "from:", this.state.active_display);
        
        // Force manual mode if trying to go to main
        if (display === 'main') {
            display = 'manual';
        }
        
        this.state.active_display = display;
        console.log("New display:", this.state.active_display);
    },

    kioskReturn(fromGreet = false) {
        console.log("kioskReturn called with:", fromGreet);
        
        if (fromGreet === true) {
            // Always return to manual after greetings
            this.state.active_display = 'manual';
            this.employeeData = null;
            return;
        }
        
        // For other cases
        if (this.state.active_display === "settings") {
            history.back();
        } else {
            this.state.active_display = 'manual'; // Always go to manual
        }
    },

    // ==================== ATTENDANCE STATUS ====================
    async _getEmployeeAttendanceStatus() {
        try {
            const result = await this.rpcService("/get_employee_attendance_status", {
                token: this.props.token,
            });
            this.state.employeeAttendanceStatus = result;
            
            if (result && result.employee_id) {
                this.state.currentEmployeeId = result.employee_id;
            }
        } catch (error) {
            console.error("Error getting attendance status:", error);
            this.state.employeeAttendanceStatus = null;
        }
    },

    // ==================== FACE RECOGNITION ====================
    async _fetchEmployeeImage(empId) {
        try {
            const result = await this.rpcService("/get_employee_image", {
                employee_id: empId,
            });
            this._imageExists = !!result;

            if (result) {
                const imgEl = this.faceImageRef.el;
                if (imgEl) {
                    imgEl.src = "data:image/jpeg;base64," + result;
                }
                this._currentEmployeeId = empId;
                return true;
            }
            return false;
        } catch (error) {
            console.error("Error fetching employee image:", error);
            this._imageExists = false;
            return false;
        }
    },

    async _enableCameraInModal() {
        const videoEl = this.cameraRef.el;
        if (!videoEl) return false;

        // Reset video element
        if (videoEl.srcObject) {
            videoEl.srcObject.getTracks().forEach(track => track.stop());
            videoEl.srcObject = null;
        }
        videoEl.style.display = "block";

        this._cameraActive = true;
        this.state.isIdentified = false;
        this.state.scanningStatus = "ready";
        this.state.errorMessage = "";
        this.state.errorTitle = "";
        this.state.errorDetails = "";
        this._matcher = null;
        this._failedAttempts = 0;

        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: "user"
                },
                audio: false,
            });
            
            this._videoStream = mediaStream;
            videoEl.srcObject = mediaStream;

            // Wait for video to be ready
            await new Promise((resolve) => {
                videoEl.onloadedmetadata = () => {
                    videoEl.play().then(resolve).catch(resolve);
                };
            });
            
            return true;
        } catch (err) {
            console.error("Webcam error:", err);
            this._cameraActive = false;
            
            // Set error message for display
            this.state.scanningStatus = "failed";
            this.state.errorMessage = _t("Camera access denied or not available. Please check browser permissions.");
            this.state.errorTitle = _t("Camera Error");
            
            return false;
        }
    },

    async _loadDescriptors() {
        const imgEl = this.faceImageRef.el;
        if (!imgEl) return null;
        
        try {
            return await faceapi
                .detectSingleFace(imgEl)
                .withFaceLandmarks()
                .withFaceExpressions()
                .withFaceDescriptor();
        } catch (error) {
            console.error("Error loading descriptors:", error);
            return null;
        }
    },

    _closeCameraModal() {
        // Stop scanning if running
        if (this._scanInterval) {
            clearInterval(this._scanInterval);
            this._scanInterval = null;
        }
        
        // Stop camera
        if (this._videoStream) {
            this._videoStream.getTracks().forEach(track => track.stop());
            this._videoStream = null;
        }
        
        // Reset state
        this._cameraActive = false;
        this.state.showCameraModal = false;
        this.state.isScanning = false;
        this.state.scanningStatus = "ready";
        this.state.selectedAction = null;
        this.state.errorMessage = "";
        this.state.errorTitle = "";
        this.state.errorDetails = "";
        this._matcher = null;
        this._failedAttempts = 0;
        
        // Reset video element
        const videoEl = this.cameraRef.el;
        if (videoEl) {
            videoEl.srcObject = null;
            videoEl.style.display = "none";
        }
        
        // Reset pending data
        this._pendingAction = null;
        this._pendingPinCode = null;
        this._pendingEmployeeId = null;
    },

    // ==================== FACE SCANNING ====================
    async _startFaceScanning() {
        console.log("Starting face scanning...");
        
        if (!this._cameraActive) {
            this.state.scanningStatus = "failed";
            this.state.errorMessage = _t("Camera is not ready.");
            this.state.errorTitle = _t("Camera Error");
            return;
        }
        
        // Step 1: Start face scanning
        this.state.isScanning = true;
        this.state.scanningStatus = "scanning";
        this.state.errorMessage = "";
        
        // Load descriptors for the selected employee
        if (!this._matcher) {
            const descriptorResult = await this._loadDescriptors();
            if (descriptorResult && descriptorResult.descriptor) {
                this._matcher = new faceapi.FaceMatcher([descriptorResult.descriptor]);
                console.log("Face descriptor loaded successfully");
            } else {
                this.state.scanningStatus = "failed";
                this.state.errorMessage = _t("Failed to load employee face data. Please try again.");
                this.state.errorTitle = _t("Face Identification Failed");
                return;
            }
        }
        
        const videoEl = this.cameraRef.el;
        if (!videoEl) {
            this.state.scanningStatus = "failed";
            this.state.errorMessage = _t("Camera element not found.");
            this.state.errorTitle = _t("Camera Error");
            return;
        }
        
        // Create canvas for face detection (hidden)
        const canvas = faceapi.createCanvasFromMedia(videoEl);
        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.zIndex = "-1";
        canvas.style.opacity = "0";
        
        const container = videoEl.parentElement;
        if (container) {
            container.appendChild(canvas);
        }
        
        const displaySize = {
            width: videoEl.videoWidth || 640,
            height: videoEl.videoHeight || 480
        };
        faceapi.matchDimensions(canvas, displaySize);
        
        // Start scanning loop
        this._failedAttempts = 0;
        const maxAttempts = 10;
        
        const scanLoop = async () => {
            if (!this.state.isScanning || !this._cameraActive) {
                if (canvas.parentNode) canvas.remove();
                return;
            }
            
            try {
                const detections = await faceapi
                    .detectAllFaces(videoEl, new faceapi.TinyFaceDetectorOptions())
                    .withFaceLandmarks()
                    .withFaceDescriptors();
                
                if (detections.length > 0) {
                    for (const detection of detections) {
                        const bestMatch = this._matcher.findBestMatch(detection.descriptor);
                        
                        if (bestMatch._distance < 0.4) {
                            // Face recognized!
                            this.state.scanningStatus = "success";
                            this.state.isIdentified = true;
                            this.state.matchedEmployeeId = this._pendingEmployeeId || this._currentEmployeeId;
                            
                            if (canvas.parentNode) canvas.remove();
                            
                            // Wait a moment then process attendance
                            setTimeout(() => {
                                this._processAttendanceAfterScan();
                            }, 1500);
                            return;
                        } else {
                            this._failedAttempts++;
                            console.log(`Recognition attempt ${this._failedAttempts}: distance = ${bestMatch._distance}`);
                        }
                    }
                    
                    // Check if too many failed attempts
                    if (this._failedAttempts >= maxAttempts) {
                        this.state.scanningStatus = "failed";
                        if (canvas.parentNode) canvas.remove();
                        
                        this.state.errorMessage = _t("Face not same. Please try again.");
                        this.state.errorTitle = _t("Recognition Failed");
                        
                        // Reset for retry
                        setTimeout(() => {
                            this.state.scanningStatus = "ready";
                            this.state.isScanning = false;
                        }, 3000);
                        return;
                    }
                }
                
                // Continue scanning
                if (this.state.isScanning) {
                    requestAnimationFrame(scanLoop);
                } else {
                    if (canvas.parentNode) canvas.remove();
                }
                
            } catch (error) {
                console.error("Scanning error:", error);
                if (canvas.parentNode) canvas.remove();
                this.state.scanningStatus = "failed";
                this.state.isScanning = false;
                this.state.errorMessage = _t("Error during face scanning: ") + error.message;
                this.state.errorTitle = _t("Scanning Error");
            }
        };
        
        // Start scanning loop
        scanLoop();
    },

    _cancelScanning() {
        this.state.isScanning = false;
        this.state.scanningStatus = "ready";
        this.state.errorMessage = "";
        this.state.errorTitle = "";
    },

    // ==================== ATTENDANCE PROCESSING ====================
    async _processAttendanceAfterScan() {
        if (!this._pendingEmployeeId && !this._currentEmployeeId) {
            this.state.scanningStatus = "failed";
            this.state.errorMessage = _t("No employee selected.");
            this.state.errorTitle = _t("Error");
            this.state.isScanning = false;
            return;
        }
        
        const employeeId = this._pendingEmployeeId || this._currentEmployeeId;
        const action = this._pendingAction || 'check_in';
        
        try {
            console.log("Processing attendance for employee:", employeeId, "action:", action);
            
            // TAMBAHKAN: Ambil geolocation dari browser
            let latitude = null;
            let longitude = null;
            let accuracy = null;
            
            if ("geolocation" in navigator) {
                try {
                    // MODIFIKASI: Ambil geolocation menggunakan promise
                    const position = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(
                            resolve,  // Success
                            reject,   // Error
                            { 
                                enableHighAccuracy: true,
                                timeout: 10000,
                                maximumAge: 0
                            }
                        );
                    });
                    
                    // MODIFIKASI: Simpan data geolocation
                    latitude = position.coords.latitude;
                    longitude = position.coords.longitude;
                    accuracy = position.coords.accuracy;
                    
                    console.log("✅ Geolocation obtained:");
                    console.log("📍 Latitude: " + latitude);
                    console.log("📍 Longitude: " + longitude);
                    console.log("🎯 Accuracy: " + accuracy + " meters");
                    
                } catch (geoError) {
                    console.error("❌ Geolocation error:");
                    console.error("Error Code: " + geoError.code);
                    console.error("Error Message: " + geoError.message);
                    // Lanjut tanpa geolocation
                }
            } else {
                console.warn("⚠️ Browser tidak mendukung Geolocation API");
            }
            
            // MODIFIKASI: Kirim ke server DENGAN geolocation
            const result = await this.rpcService("manual_selection", {
                token: this.props.token,
                employee_id: employeeId,
                pin_code: this._pendingPinCode,
                action: action,
                latitude: latitude || false,    // ← KIRIM ke server
                longitude: longitude || false   // ← KIRIM ke server
            });
            
            console.log("Attendance result:", result);
            
            if (result && result.attendance) {
                // SUCCESS
                this.employeeData = result;
                
                // Update attendance status
                await this._getEmployeeAttendanceStatus();
                
                // Wait then close modal and go to greetings
                setTimeout(() => {
                    this._closeCameraModal();
                    this.switchDisplay("greet");
                }, 1000);
                
            } else {
                // Attendance failed - show error in modal
                this.state.scanningStatus = "attendance_error";
                this.state.isScanning = false;
                
                if (this._pendingPinCode) {
                    this.state.errorTitle = _t("Authentication Failed");
                    this.state.errorMessage = _t("Incorrect PIN code.");
                } else {
                    this.state.errorTitle = _t("Attendance Failed");
                    this.state.errorMessage = _t("Failed to record attendance.");
                }
            }
            
        } catch (error) {
            console.error("Attendance processing error:", error);
            this.state.isScanning = false;
            
            // Handle Python validation errors
            this._handleAttendanceError(error);
        }
    },

    _handleAttendanceError(error) {
        this.state.scanningStatus = "attendance_error";
        this.state.isScanning = false; // TAMBAHKAN: Pastikan scanning berhenti
        
        let errorTitle = _t("Attendance Error");
        let errorMessage = _t("An error occurred while processing attendance.");
        let errorDetails = "";
        
        if (error && error.data) {
            if (error.data.message) {
                errorMessage = error.data.message;
            }
            if (error.data.name) {
                errorTitle = error.data.name;
            }
            
            // Handle specific errors from Python validation
            if (errorMessage.includes("No planning slot found")) {
                errorTitle = _t("No Work Schedule");
                errorMessage = _t("Employee doesn't have work schedule for today.");
                errorDetails = _t("Please contact HR department for assistance.");
            } else if (errorMessage.includes("has no project_id")) {
                errorTitle = _t("No Project Assigned");
                errorMessage = _t("Work schedule has no project assigned.");
                errorDetails = _t("Project assignment is required for attendance.");
            } else if (errorMessage.includes("outside the allowed range")) {
                errorTitle = _t("Location Restricted");
                errorMessage = _t("You are outside the allowed project area.");
                errorDetails = _t("Please move to the designated project location.");
            } else if (errorMessage.includes("has no GPS")) {
                errorTitle = _t("Location Required");
                errorMessage = _t("GPS location is required for attendance.");
                errorDetails = _t("Please enable location services on your device.");
            } else if (errorMessage.includes("already checked in")) {
                errorTitle = _t("Already Checked In");
                errorMessage = _t("Employee has already checked in for today.");
            } else if (errorMessage.includes("already checked out")) {
                errorTitle = _t("Already Checked Out");
                errorMessage = _t("Employee has already checked out for today.");
            } else if (error.data.debug) {
                errorDetails = error.data.debug;
            }
        } else if (error && error.message) {
            errorMessage = error.message;
        }
        
        // Set state for display in modal
        this.state.errorTitle = errorTitle;
        this.state.errorMessage = errorMessage;
        this.state.errorDetails = errorDetails;
        
        // Also log to console for debugging
        console.error(`[${errorTitle}] ${errorMessage}`);
        if (errorDetails) {
            console.error(`Details: ${errorDetails}`);
        }
    },

    // ==================== MAIN ENTRY POINTS ====================
    async _showFaceRecognitionForAction(employeeId, actionType, pinCode = null) {
        console.log("Show face recognition for action:", actionType, "employee:", employeeId);
        
        // If no employeeId, go to manual selection
        if (!employeeId) {
            this.switchDisplay('manual');
            this._pendingAction = actionType;
            return;
        }

        this._pendingEmployeeId = employeeId;
        this._pendingAction = actionType;
        this._pendingPinCode = pinCode;
        
        // Set modal title based on action
        this.state.selectedAction = actionType;
        
        // Load employee image
        const imageLoaded = await this._fetchEmployeeImage(employeeId);
        
        if (imageLoaded) {
            this.state.showCameraModal = true;
            
            // Wait for DOM update
            setTimeout(async () => {
                const cameraStarted = await this._enableCameraInModal();
                
                if (!cameraStarted) {
                    this._closeCameraModal();
                }
            }, 100);
        } else {
            this.state.scanningStatus = "attendance_error";
            this.state.errorTitle = _t("Face Data Not Found");
            this.state.errorMessage = _t("No face data found for this employee.");
            this.state.showCameraModal = true;
        }
    },

    async onManualSelection(employeeId, pinCode) {
        console.log("onManualSelection called for employee:", employeeId);
        
        this._pendingEmployeeId = employeeId;
        this._pendingPinCode = pinCode;
        
        // Load employee image
        const imageLoaded = await this._fetchEmployeeImage(employeeId);
        
        if (imageLoaded) {
            this.state.showCameraModal = true;
            
            setTimeout(async () => {
                const cameraStarted = await this._enableCameraInModal();
                
                if (!cameraStarted) {
                    this._closeCameraModal();
                }
            }, 100);
        } else {
            this.state.scanningStatus = "attendance_error";
            this.state.errorTitle = _t("Authentication Failed");
            this.state.errorMessage = _t("No image found for the selected employee.");
            this.state.showCameraModal = true;
        }
    },

    // Override kioskConfirm untuk handle pending action
    async kioskConfirm(employeeData) {
        if (this._pendingAction) {
            // Jika ada pending action, langsung ke face recognition
            await this._showFaceRecognitionForAction(employeeData.id, this._pendingAction);
        } else {
            // Jika tidak, jalankan flow biasa
            await super.kioskConfirm(employeeData);
        }
    },
});