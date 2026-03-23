from odoo import http
from odoo.http import request
from odoo.addons.hr_attendance.controllers.main import HrAttendance
import datetime  # <-- TAMBAHKAN INI


class HrAttendances(HrAttendance):
    @http.route("/get_employee_image", type="json", auth="public")
    def get_employee_image(self, employee_id):
        image = request.env["hr.employee"].sudo().browse(employee_id).image_1920
        return image
    
    @http.route('/hr_attendance/get_today_attendance', type='json', auth='public')
    def get_today_attendance(self, token, employee_ids):
        """Get today's attendance status for multiple employees"""
        # Cari company berdasarkan token
        company = request.env['res.company'].sudo().search([
            ('attendance_kiosk_key', '=', token)
        ], limit=1)
        
        if not company:
            return {}
        
        today = datetime.date.today()
        tomorrow = today + datetime.timedelta(days=1)
        
        attendance_data = {}
        
        # Convert employee_ids ke list jika single value
        if not isinstance(employee_ids, list):
            employee_ids = [employee_ids]
        
        # Convert to integers
        emp_ids = [int(eid) for eid in employee_ids]
        
        # Cari semua attendance untuk hari ini
        attendances = request.env['hr.attendance'].sudo().search([
            ('employee_id', 'in', emp_ids),
            ('employee_id.company_id', '=', company.id),
            ('check_in', '>=', today),
            ('check_in', '<', tomorrow),
        ])
        
        # Mapping per employee
        for emp_id in emp_ids:
            emp_attendance = attendances.filtered(lambda a: a.employee_id.id == emp_id)
            
            if emp_attendance:
                # Ambil yang terbaru
                latest = emp_attendance.sorted('check_in', reverse=True)[0]
                attendance_data[str(emp_id)] = {
                    'has_checked_in': True,
                    'has_checked_out': bool(latest.check_out),
                    'check_in_time': latest.check_in.strftime('%H:%M') if latest.check_in else None,
                    'check_out_time': latest.check_out.strftime('%H:%M') if latest.check_out else None,
                }
            else:
                attendance_data[str(emp_id)] = {
                    'has_checked_in': False,
                    'has_checked_out': False,
                    'check_in_time': None,
                    'check_out_time': None,
                }
        
        return attendance_data