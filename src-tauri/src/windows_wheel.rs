use std::ffi::c_void;
use tauri::{Emitter, WebviewWindow};

type HWND = *mut c_void;
type WPARAM = usize;
type LPARAM = isize;
type LRESULT = isize;

type SUBCLASSPROC = unsafe extern "system" fn(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id_subclass: usize,
    ref_data: usize,
) -> LRESULT;

#[link(name = "comctl32")]
extern "system" {
    fn SetWindowSubclass(
        hWnd: HWND,
        pfnSubclass: Option<SUBCLASSPROC>,
        uIdSubclass: usize,
        dwRefData: usize,
    ) -> i32;

    fn RemoveWindowSubclass(
        hWnd: HWND,
        pfnSubclass: Option<SUBCLASSPROC>,
        uIdSubclass: usize,
    ) -> i32;

    fn DefSubclassProc(hWnd: HWND, uMsg: u32, wParam: WPARAM, lParam: LPARAM) -> LRESULT;
}

const WM_NCDESTROY: u32 = 0x0082;
const WM_MOUSEHWHEEL: u32 = 0x020E;
const HORIZONTAL_WHEEL_SUBCLASS_ID: usize = 1001;

struct SubclassData {
    window: WebviewWindow,
}

unsafe extern "system" fn window_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id_subclass: usize,
    ref_data: usize,
) -> LRESULT {
    if msg == WM_MOUSEHWHEEL {
        let delta = (wparam >> 16) as i16;
        let data_ptr = ref_data as *const SubclassData;

        if !data_ptr.is_null() {
            let data = unsafe { &*data_ptr };
            let _ = data.window.emit("native-horizontal-wheel", delta);
        }

        return 0;
    }

    if msg == WM_NCDESTROY {
        let data_ptr = ref_data as *mut SubclassData;

        unsafe {
            RemoveWindowSubclass(hwnd, Some(window_subclass_proc), id_subclass);
            if !data_ptr.is_null() {
                drop(Box::from_raw(data_ptr));
            }
            return DefSubclassProc(hwnd, msg, wparam, lparam);
        }
    }

    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

pub fn setup_horizontal_wheel_hook(window: WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|err| err.to_string())?;
    let hwnd_ptr = hwnd.0 as HWND;
    let data_ptr = Box::into_raw(Box::new(SubclassData { window }));

    let installed = unsafe {
        SetWindowSubclass(
            hwnd_ptr,
            Some(window_subclass_proc),
            HORIZONTAL_WHEEL_SUBCLASS_ID,
            data_ptr as usize,
        )
    };

    if installed == 0 {
        unsafe {
            drop(Box::from_raw(data_ptr));
        }
        return Err("Windows 가로 휠 훅을 설치할 수 없습니다".to_string());
    }

    Ok(())
}
