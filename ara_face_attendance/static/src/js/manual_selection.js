/* @odoo-module */

import { KioskManualSelection } from "@hr_attendance/components/manual_selection/manual_selection"
import { patch } from "@web/core/utils/patch"
import { rpc } from "@web/core/network/rpc"

patch(KioskManualSelection.prototype, {
    setup() {
        super.setup(...arguments)

        // Tambahkan state untuk attendance status
        this.state.employeesAttendance = {}

        // Load attendance data saat setup
        this._fetchEmployeeAttendance()
    },

    async _fetchEmployeeAttendance() {
        console.log("Fetching attendance data...")

        if (
            !this.state.employeesData.records ||
            this.state.employeesData.records.length === 0
        ) {
            console.log("No employee records found")
            return
        }

        const employeeIds = this.state.employeesData.records.map(emp => emp.id)
        console.log("Employee IDs:", employeeIds)
        console.log("Token:", this.props.token)

        try {
            // Panggil endpoint custom
            console.log("Calling /hr_attendance/get_today_attendance...")
            const attendanceData = await rpc(
                "/hr_attendance/get_today_attendance",
                {
                    token: this.props.token,
                    employee_ids: employeeIds,
                }
            )

            console.log("Attendance data received:", attendanceData)
            this.state.employeesAttendance = attendanceData || {}
        } catch (error) {
            console.error("Error fetching attendance data:", error)
            console.error("Error details:", error.message, error.data)

            // Fallback ke method yang lebih sederhana
            await this._fetchSimpleAttendance(employeeIds)
        }
    },

    async _fetchSimpleAttendance(employeeIds) {
        console.log("Using fallback method...")
        const attendanceData = {}

        for (const empId of employeeIds) {
            try {
                console.log(`Fetching data for employee ${empId}...`)
                const employeeInfo = await rpc(
                    "/hr_attendance/attendance_employee_data",
                    {
                        token: this.props.token,
                        employee_id: empId,
                    }
                )

                console.log(`Employee ${empId} data:`, employeeInfo)

                if (employeeInfo && employeeInfo.attendance) {
                    const today = new Date()
                    const todayStr = today.toISOString().split("T")[0]

                    let hasCheckedIn = false
                    let hasCheckedOut = false
                    let checkInTime = null
                    let checkOutTime = null

                    if (employeeInfo.attendance.check_in) {
                        const checkInDate = new Date(
                            employeeInfo.attendance.check_in
                        )
                        const checkInDateStr = checkInDate
                            .toISOString()
                            .split("T")[0]

                        if (checkInDateStr === todayStr) {
                            hasCheckedIn = true
                            checkInTime = checkInDate.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                            })

                            // Cek apakah sudah check out
                            if (employeeInfo.attendance.check_out) {
                                const checkOutDate = new Date(
                                    employeeInfo.attendance.check_out
                                )
                                const checkOutDateStr = checkOutDate
                                    .toISOString()
                                    .split("T")[0]

                                if (checkOutDateStr === todayStr) {
                                    hasCheckedOut = true
                                    checkOutTime =
                                        checkOutDate.toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })
                                }
                            }
                        }
                    }

                    attendanceData[empId] = {
                        has_checked_in: hasCheckedIn,
                        has_checked_out: hasCheckedOut,
                        check_in_time: checkInTime,
                        check_out_time: checkOutTime,
                    }
                } else {
                    attendanceData[empId] = {
                        has_checked_in: false,
                        has_checked_out: false,
                        check_in_time: null,
                        check_out_time: null,
                    }
                }
            } catch (err) {
                console.error(`Error for employee ${empId}:`, err)
                attendanceData[empId] = {
                    has_checked_in: false,
                    has_checked_out: false,
                    check_in_time: null,
                    check_out_time: null,
                }
            }
        }

        this.state.employeesAttendance = attendanceData
        console.log("Fallback attendance data:", attendanceData)
    },

    // Helper function untuk mendapatkan status employee
    getEmployeeAttendanceStatus(employeeId) {
        const status = this.state.employeesAttendance[employeeId] || {
            has_checked_in: false,
            has_checked_out: false,
            check_in_time: null,
            check_out_time: null,
        }
        console.log(`Status for employee ${employeeId}:`, status)
        return status
    },

    // Function untuk menentukan tombol yang ditampilkan
    // shouldShowCheckInButton(employeeId) {
    //     const status = this.getEmployeeAttendanceStatus(employeeId)
    //     console.log("Status:", status)
    //     const show = status.has_checked_in
    //     console.log(`Show Check In for ${employeeId}: ${show}`)
    //     return show
    // },
    shouldShowCheckInButton(employeeId) {
        const status = this.getEmployeeAttendanceStatus(employeeId)
        const show = status.has_checked_in && !status.has_checked_out
        
        return show
    },

    shouldShowCheckOutButton(employeeId) {
        const status = this.getEmployeeAttendanceStatus(employeeId)
        const show = status.has_checked_in && !status.has_checked_out
        console.log(`Show Check Out for ${employeeId}: ${show}`)
        return show
    },

    // Override function yang memuat data employee
    async _fetchEmployeeData() {
        await super._fetchEmployeeData(...arguments)
        console.log("Employee data fetched, now loading attendance...")
        await this._fetchEmployeeAttendance()
    },

    async _onPagerChanged({ offset, limit }) {
        await super._onPagerChanged(...arguments)
        await this._fetchEmployeeAttendance()
    },

    async onDepartmentClick(departmentId = false) {
        await super.onDepartmentClick(...arguments)
        await this._fetchEmployeeAttendance()
    },

    async onSearchInput(ev) {
        await super.onSearchInput(...arguments)
        await this._fetchEmployeeAttendance()
    },

    // Handler untuk button click dengan action type
    onCheckInClick(employeeId) {
        console.log("Check In clicked for employee:", employeeId)
        this.props.onSelectEmployee(employeeId, "check_in")
    },

    onCheckOutClick(employeeId) {
        console.log("Check Out clicked for employee:", employeeId)
        this.props.onSelectEmployee(employeeId, "check_out")
    },
})
